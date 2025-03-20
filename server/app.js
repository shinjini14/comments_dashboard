require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const pool = require("./db"); // PostgreSQL connection
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const { Translate } = require("@google-cloud/translate").v2;
const credentials = JSON.parse(process.env.GOOGLE_AUTH);
const translate = new Translate({ credentials });
const app = express();
const PORT = 5000;
const BATCH_SIZE = 100; // Adjust to a batch size that suits your API usage
app.use(express.json());
app.use(cors());
// --------------------------------------------------
// 1) Login
// --------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM comments_login WHERE username = $1 AND password = $2",
      [username, password]
    );
    const user = result.rows[0];
    if (user) {
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      res.json({ success: true, token, role: user.role, username: user.username });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Error in /api/auth/login:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Function to retry the sentiment API request in case of failure
const fetchSentimentWithRetry = async (payload, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.post(
          "http://34.66.186.236/api/v0/get_comments_prediction",
          payload
        );
        // If API indicates success, return the array of predictions
        if (response.data.success) return response.data.comments;
        console.warn("⚠️ Sentiment API returned unsuccessful response. Retrying...");
      } catch (error) {
        console.error(
          `❌ Sentiment API call failed (attempt ${i + 1}):`,
          error.response ? error.response.data : error
        );
      }
      // Wait 2 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.error("🚨 Sentiment API failed after multiple retries.");
    return null; // Return null if all retries fail
  };
  
  // Function to process (translate + sentiment) a single batch
  const processBatch = async (batch) => {
    try {
      console.log(`🚀 Processing batch of ${batch.length} comments...`);
  
      // Step 1: Detect and translate non-English comments in parallel
      const translatedComments = await Promise.all(
        batch.map(async (comment) => {
          try {
            const [detection] = await translate.detect(comment.main_comment);
            if (detection.language !== "en") {
              const [translated] = await translate.translate(comment.main_comment, "en");
              return { id: comment.id, text: translated };
            }
            // If already English, return original text
            return { id: comment.id, text: comment.main_comment };
          } catch (error) {
            console.error(`❌ Translation failed for comment ID ${comment.id}:`, error);
            // If translation fails, use original text
            return { id: comment.id, text: comment.main_comment };
          }
        })
      );
  
      console.log(
        `📤 Sending batch of ${translatedComments.length} comments for sentiment analysis...`
      );
  
      // Step 2: Get sentiment predictions with retry
      const predictions = await fetchSentimentWithRetry({
        comments: translatedComments.map((c) => c.text),
      });
      if (!predictions) return; // If API fails, skip further processing
  
      // Step 3: Bulk update sentiment_tag in comments_api
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < translatedComments.length; i++) {
          const sentiment = predictions[i] === "negative" ? "bad" : "good";
          // Update each row's sentiment_tag
          await client.query(
            "UPDATE comments_api SET sentiment_tag = $1 WHERE id = $2",
            [sentiment, translatedComments[i].id]
          );
        }
        await client.query("COMMIT");
        console.log(
          `✅ Successfully updated ${translatedComments.length} comments in the database.`
        );
      } catch (updateError) {
        await client.query("ROLLBACK");
        console.error("❌ Database update failed:", updateError);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("❌ Error processing batch:", error);
    }
  };
  
  // Main function to process all comments from comments_api in batches
  const processAllComments = async () => {
    try {
      // 1) Fetch all rows from comments_api
      const { rows: allComments } = await pool.query(
        "SELECT id, main_comment FROM comments_api"
      );
      if (!allComments.length) {
        console.log("✅ No comments found in comments_api.");
        return;
      }
      console.log(`✅ Queuing ${allComments.length} comments for processing...`);
  
      // 2) Process them in batches to avoid timeouts or overload
      let batchIndex = 1;
      for (let i = 0; i < allComments.length; i += BATCH_SIZE) {
        const batch = allComments.slice(i, i + BATCH_SIZE);
        console.log(
          `⏳ Processing batch ${batchIndex}/${Math.ceil(allComments.length / BATCH_SIZE)}`
        );
        await processBatch(batch);
        batchIndex++;
      }
  
      console.log("🎉 Sentiment analysis completed for all comments in comments_api.");
    } catch (error) {
      console.error("❌ Error processing all comments:", error);
    }
  };
  
  // An API route to start processing (for all comments in comments_api)
  app.post("/api/comments/analyze", async (req, res) => {
    try {
      console.log("📢 Starting sentiment analysis for ALL comments in comments_api...");
      // Kick off the async job
      processAllComments();
      // Return immediately so the request doesn't hang
      res.json({
        message: "Sentiment analysis started. Results will update soon.",
      });
    } catch (error) {
      console.error("❌ Error analyzing comments:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

// --------------------------------------------------
// 2) Get Comments By Type
//    (Main => comments_api, Good => good_comments, Bad => bad_comments)
// --------------------------------------------------
app.get("/comments/:type", async (req, res) => {
    const { type } = req.params;
    let table = "comments_api"; // default
    if (type === "good") table = "good_comments";
    if (type === "bad") table = "bad_comments";
  
    try {
      // Order by "bad" first, then by updated_at desc
      const result = await pool.query(`
        SELECT *
        FROM ${table}
        ORDER BY (sentiment_tag = 'bad') DESC, updated_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
// --------------------------------------------------
// 3) Get Videos
// --------------------------------------------------
app.get("/api/videos", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, url FROM video");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// --------------------------------------------------
// 4) Get Comment Details for a Given Video ID
// --------------------------------------------------
app.get("/api/comments/:video_id/details", async (req, res) => {
    const { video_id } = req.params;
    try {
      // First, fetch the video's URL from the video table.
      const { rows: videoRows } = await pool.query(
        "SELECT url FROM video WHERE id = $1",
        [video_id]
      );
      if (videoRows.length === 0) {
        return res.status(404).json({ error: "Video not found" });
      }
      const videoUrl = videoRows[0].url;
      // Determine if this is a YouTube video based on the URL.
      const isYouTube =
        videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");
  
      if (isYouTube) {
        // For YouTube comments, remap columns:
        // - "text" becomes main_comment
        // - "author" becomes main_comment_user
        const { rows: comments } = await pool.query(
          `SELECT text AS main_comment, author AS main_comment_user
           FROM comments_api
           WHERE video_id = $1`,
          [video_id]
        );
        // Get the preview image from the YouTube-specific statistics table.
        const { rows: vid } = await pool.query(
          "SELECT preview FROM statistics_youtube_api WHERE video_id = $1",
          [video_id]
        );
        if (comments.length === 0) {
          return res
            .status(404)
            .json({ error: "No YouTube comments found for the video_id" });
        }
        const mainComment = comments[0];
        return res.json({
          main_comment: mainComment.main_comment,
          main_comment_user: mainComment.main_comment_user,
          preview: vid.length > 0 ? vid[0].preview : null,
          // Assuming YouTube comments do not have replies in the same way:
          replies: []
        });
      } else {
        // For standard comments, use comments_api and statistics.
        const { rows: comments } = await pool.query(
          `SELECT main_comment, main_comment_user, reply_user, reply
           FROM comments_api
           WHERE video_id = $1`,
          [video_id]
        );
        const { rows: vid } = await pool.query(
          "SELECT preview FROM statistics WHERE video_id = $1",
          [video_id]
        );
        if (comments.length === 0) {
          return res
            .status(404)
            .json({ error: "No comments found for the video_id" });
        }
        const mainComment = comments[0];
        const replies = comments
          .filter((c) => c.reply_user && c.reply)
          .map((c) => ({
            reply_user: c.reply_user,
            reply: c.reply
          }));
        return res.json({
          main_comment: mainComment.main_comment,
          main_comment_user: mainComment.main_comment_user,
          preview: vid.length > 0 ? vid[0].preview : null,
          replies
        });
      }
    } catch (error) {
      console.error("Error fetching comment details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  
// --------------------------------------------------
// 5) Approve/Reject/Undo Single
// --------------------------------------------------
// Move from comments_api -> good_comments
app.post("/approve/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const moveQuery = `
        WITH moved AS (
          DELETE FROM comments_api WHERE id = $1 RETURNING *
        )
        INSERT INTO good_comments SELECT * FROM moved;
      `;
      await pool.query(moveQuery, [id]);
      res.json({ success: true, message: "Comment approved" });
    } catch (error) {
      console.error("Error approving comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // Move from comments_api -> bad_comments
  app.post("/reject/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const moveQuery = `
        WITH moved AS (
          DELETE FROM comments_api WHERE id = $1 RETURNING *
        )
        INSERT INTO bad_comments SELECT * FROM moved;
      `;
      await pool.query(moveQuery, [id]);
      res.json({ success: true, message: "Comment rejected" });
    } catch (error) {
      console.error("Error rejecting comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // Undo from good_comments or bad_comments -> comments_api
  app.post("/undo/:id", async (req, res) => {
    const { id } = req.params;
    try {
      let query = `
        WITH moved AS (
          DELETE FROM good_comments WHERE id = $1 RETURNING *
        )
        INSERT INTO comments_api SELECT * FROM moved;
      `;
      let result = await pool.query(query, [id]);
  
      if (result.rowCount === 0) {
        // Not in good_comments => try bad_comments
        query = `
          WITH moved AS (
            DELETE FROM bad_comments WHERE id = $1 RETURNING *
          )
          INSERT INTO comments_api SELECT * FROM moved;
        `;
        await pool.query(query, [id]);
      }
  
      res.json({ success: true, message: "Comment restored to main dashboard" });
    } catch (error) {
      console.error("Error undoing comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // --------------------------------------------------
  // 6) Bulk Approve/Reject/Undo
  // --------------------------------------------------
  app.post("/bulk/approve", async (req, res) => {
    const { ids } = req.body;
    try {
      const moveQuery = `
        WITH moved AS (
          DELETE FROM comments_api WHERE id = ANY($1) RETURNING *
        )
        INSERT INTO good_comments SELECT * FROM moved;
      `;
      await pool.query(moveQuery, [ids]);
      res.json({ success: true, message: "Bulk approval successful" });
    } catch (error) {
      console.error("Error in bulk approval:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/bulk/reject", async (req, res) => {
    const { ids } = req.body;
    try {
      const moveQuery = `
        WITH moved AS (
          DELETE FROM comments_api WHERE id = ANY($1) RETURNING *
        )
        INSERT INTO bad_comments SELECT * FROM moved;
      `;
      await pool.query(moveQuery, [ids]);
      res.json({ success: true, message: "Bulk rejection successful" });
    } catch (error) {
      console.error("Error in bulk rejection:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/bulk/undo", async (req, res) => {
    const { ids } = req.body;
    try {
      // Try removing from good_comments first
      const resultGood = await pool.query(
        `
        WITH moved AS (
          DELETE FROM good_comments WHERE id = ANY($1) RETURNING *
        )
        INSERT INTO comments_api SELECT * FROM moved;
        `,
        [ids]
      );
  
      // If some IDs weren't found in good_comments, they might be in bad_comments
      if (resultGood.rowCount < ids.length) {
        await pool.query(
          `
          WITH moved AS (
            DELETE FROM bad_comments WHERE id = ANY($1) RETURNING *
          )
          INSERT INTO comments_api SELECT * FROM moved;
          `,
          [ids]
        );
      }
  
      res.json({ success: true, message: "Bulk undo successful" });
    } catch (error) {
      console.error("Error in bulk undo:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // --------------------------------------------------
  // 7) Bulk Delete (from main/good/bad)
  // --------------------------------------------------
  app.post("/comments/:type/bulk-delete", async (req, res) => {
    const { type } = req.params;
    const { ids } = req.body;
  
    let table = "comments_api";
    if (type === "good") table = "good_comments";
    if (type === "bad") table = "bad_comments";
  
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids]);
      res.json({ success: true, message: "Bulk delete successful" });
    } catch (error) {
      console.error("Error in bulk delete:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
// --------------------------------------------------
// 8) Translate API
// --------------------------------------------------
app.post("/api/translate", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });
  try {
    // Google Translate
    const [translation] = await translate.translate(text, "en");
    res.json({ translatedText: translation });
  } catch (error) {
    console.error("Translation Error:", error);
    res.status(500).json({ error: "Translation failed." });
  }
});
// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
