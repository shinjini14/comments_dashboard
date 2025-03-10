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

const BATCH_SIZE = 500; // Process in smaller batches

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


// Function to retry sentiment API request in case of failure
const fetchSentimentWithRetry = async (payload, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.post(
          "http://34.66.186.236/api/v0/get_comments_prediction",
          payload
        );
        if (response.data.success) return response.data.comments; // If API succeeds, return results
        console.warn(
          "⚠️ Sentiment API returned unsuccessful response. Retrying..."
        );
      } catch (error) {
        console.error(
          `❌ Sentiment API call failed (attempt ${i + 1}):`,
          error.response ? error.response.data : error
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s before retrying
    }
    console.error("🚨 Sentiment API failed after multiple retries.");
    return null; // Return null if all retries fail
  };
  // Function to process a batch of comments
  const processBatch = async (batch) => {
    try {
      console.log(`🚀 Processing batch of ${batch.length} comments...`);
      // Step 1: Detect and translate non-English comments in parallel
      const translatedComments = await Promise.all(
        batch.map(async (comment) => {
          try {
            const [detection] = await translate.detect(comment.main_comment);
            if (detection.language !== "en") {
              const [translated] = await translate.translate(
                comment.main_comment,
                "en"
              );
              return { id: comment.id, text: translated };
            }
            return { id: comment.id, text: comment.main_comment };
          } catch (error) {
            console.error(
              `❌ Translation failed for comment ID ${comment.id}:`,
              error
            );
            return { id: comment.id, text: comment.main_comment }; // Use original text if translation fails
          }
        })
      );
      console.log(
        `📤 Sending batch of ${translatedComments.length} comments for sentiment analysis...`
      );
      // Step 2: Send translated comments for sentiment analysis with retry
      const predictions = await fetchSentimentWithRetry({
        comments: translatedComments.map((c) => c.text),
      });
      if (!predictions) return; // Skip if sentiment API failed
      // Step 3: Bulk update sentiment tags using transactions
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < translatedComments.length; i++) {
          await client.query(
            "UPDATE comments_api SET sentiment_tag = $1 WHERE id = $2",
            [
              predictions[i] === "negative" ? "bad" : "good",
              translatedComments[i].id,
            ]
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
  const processAllComments = (comments) => {
    setImmediate(async () => {
      try {
        let batchIndex = 1;
        for (let i = 0; i < comments.length; i += BATCH_SIZE) {
          const batch = comments.slice(i, i + BATCH_SIZE);
          console.log(
            `⏳ Processing batch ${batchIndex}/${Math.ceil(
              comments.length / BATCH_SIZE
            )}`
          );
          await processBatch(batch); // Ensure each batch completes before moving on
          batchIndex++;
        }
        console.log("🎉 Sentiment analysis completed in the background.");
      } catch (error) {
        console.error("❌ Error processing all comments:", error);
      }
    });
  };
  // API Route to Start Processing
  app.post("/api/comments/analyze", async (req, res) => {
    try {
      console.log("📢 Starting sentiment analysis for ALL comments...");
      // Fetch all comments (NOT just untagged ones)
      const { rows: comments } = await pool.query(
        "SELECT id, main_comment FROM comments_api"
      );
      if (comments.length === 0) {
        console.log("✅ No comments found.");
        return res.json({ message: "No comments found." });
      }
      console.log(`✅ Queuing ${comments.length} comments for processing...`);
      // Process comments asynchronously (in background)
      processAllComments(comments);
      // Return immediately to avoid timeout
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
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      if (source === "youtube") {
        let table = "youtube_comments"; // main YouTube comments
        if (type === "good") table = "youtube_good";
        if (type === "bad") table = "youtube_bad";
        // For YouTube, join with statistics_youtube_api to get updated_at
        if (table === "youtube_comments") {
          const result = await pool.query(`
            SELECT c.*, s.updated_at
            FROM youtube_comments c
            LEFT JOIN statistics_youtube_api s
              ON CAST(c.video_db_id AS VARCHAR(50)) = s.video_id
            ORDER BY (c.sentiment_tag = 'bad') DESC, s.updated_at DESC
          `);
          res.json(result.rows);
        } else {
          // For youtube_good or youtube_bad, assume they have an "updated_at" column already.
          const result = await pool.query(`
            SELECT * FROM ${table}
            ORDER BY (sentiment_tag = 'bad') DESC, time DESC
          `);
          res.json(result.rows);
        }
      } else {
        // For standard comments
        let table = "comments_api";
        if (type === "good") table = "good_comments";
        if (type === "bad") table = "bad_comments";
        const result = await pool.query(`
          SELECT * FROM ${table}
          ORDER BY (sentiment_tag = 'bad') DESC, updated_at DESC
        `);
        res.json(result.rows);
      }
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
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let commentsQuery, statsQuery;
      if (source === "youtube") {
        commentsQuery = `
          SELECT text AS main_comment, author AS main_comment_user
          FROM youtube_comments
          WHERE video_db_id = $1
        `;
        statsQuery = `
          SELECT preview
          FROM statistics_youtube_api
          WHERE video_id = $1
        `;
      } else {
        commentsQuery = `
          SELECT main_comment, main_comment_user, reply_user, reply
          FROM comments_api
          WHERE video_id = $1
        `;
        statsQuery = `
          SELECT preview
          FROM statistics
          WHERE video_id = $1
        `;
      }
      const { rows: comments } = await pool.query(commentsQuery, [video_id]);
      if (comments.length === 0) {
        return res.status(404).json({ error: "No comments found for the video_id" });
      }
      const { rows: vid } = await pool.query(statsQuery, [video_id]);
      const mainComment = comments[0];
      const replies = comments
        .filter((c) => c.reply_user && c.reply)
        .map((c) => ({ reply_user: c.reply_user, reply: c.reply }));
      res.json({
        main_comment: mainComment.main_comment,
        main_comment_user: mainComment.main_comment_user,
        preview: vid.length > 0 ? vid[0].preview : null,
        replies,
      });
    } catch (error) {
      console.error("Error fetching comment details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // --------------------------------------------------
  // 5) Single Actions: Approve, Reject, Undo
  //    For YouTube: Map columns from youtube_comments (using comment_id, video_db_id, text, author, time)
  //    For standard: use existing logic.
  // --------------------------------------------------
  app.post("/approve/:id", async (req, res) => {
    const { id } = req.params;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        // For YouTube, delete from youtube_comments and insert into youtube_good.
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id::text = $1 RETURNING *
          )
          INSERT INTO youtube_good SELECT * FROM moved;
        `;
      } else {
        moveQuery = `
          WITH moved AS (
            DELETE FROM comments_api WHERE id = $1 RETURNING *
          )
          INSERT INTO good_comments SELECT * FROM moved;
        `;
      }
      await pool.query(moveQuery, [id]);
      res.json({ success: true, message: "Comment approved" });
    } catch (error) {
      console.error("Error approving comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/reject/:id", async (req, res) => {
    const { id } = req.params;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id::text = $1 RETURNING *
          )
          INSERT INTO youtube_bad SELECT * FROM moved;
        `;
      } else {
        moveQuery = `
          WITH moved AS (
            DELETE FROM comments_api WHERE id = $1 RETURNING *
          )
          INSERT INTO bad_comments SELECT * FROM moved;
        `;
      }
      await pool.query(moveQuery, [id]);
      res.json({ success: true, message: "Comment rejected" });
    } catch (error) {
      console.error("Error rejecting comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/undo/:id", async (req, res) => {
    const { id } = req.params;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let query;
      if (source === "youtube") {
        // Try undoing from youtube_good; if not found, try from youtube_bad.
        query = `
          WITH moved AS (
            DELETE FROM youtube_good WHERE comment_id::text = $1 RETURNING *
          )
          INSERT INTO youtube_comments SELECT * FROM moved;
        `;
        let result = await pool.query(query, [id]);
        if (result.rowCount === 0) {
          query = `
            WITH moved AS (
              DELETE FROM youtube_bad WHERE comment_id::text = $1 RETURNING *
            )
            INSERT INTO youtube_comments SELECT * FROM moved;
          `;
          await pool.query(query, [id]);
        }
      } else {
        query = `
          WITH moved AS (
            DELETE FROM good_comments WHERE id = $1 RETURNING *
          )
          INSERT INTO comments_api SELECT * FROM moved;
        `;
        let result = await pool.query(query, [id]);
        if (result.rowCount === 0) {
          query = `
            WITH moved AS (
              DELETE FROM bad_comments WHERE id = $1 RETURNING *
            )
            INSERT INTO comments_api SELECT * FROM moved;
          `;
          await pool.query(query, [id]);
        }
      }
      res.json({ success: true, message: "Comment restored to main dashboard" });
    } catch (error) {
      console.error("Error undoing comment:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // --------------------------------------------------
  // 6) Bulk Actions: Approve / Reject / Undo
  // --------------------------------------------------
  app.post("/bulk/approve", async (req, res) => {
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id::text = ANY($1) RETURNING *
          )
          INSERT INTO youtube_good SELECT * FROM moved;
        `;
      } else {
        moveQuery = `
          WITH moved AS (
            DELETE FROM comments_api WHERE id = ANY($1) RETURNING *
          )
          INSERT INTO good_comments SELECT * FROM moved;
        `;
      }
      await pool.query(moveQuery, [ids]);
      res.json({ success: true, message: "Bulk approval successful" });
    } catch (error) {
      console.error("Error in bulk approval:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/bulk/reject", async (req, res) => {
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id::text = ANY($1) RETURNING *
          )
          INSERT INTO youtube_bad SELECT * FROM moved;
        `;
      } else {
        moveQuery = `
          WITH moved AS (
            DELETE FROM comments_api WHERE id = ANY($1) RETURNING *
          )
          INSERT INTO bad_comments SELECT * FROM moved;
        `;
      }
      await pool.query(moveQuery, [ids]);
      res.json({ success: true, message: "Bulk rejection successful" });
    } catch (error) {
      console.error("Error in bulk rejection:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  app.post("/bulk/undo", async (req, res) => {
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let resultGood;
      if (source === "youtube") {
        resultGood = await pool.query(
          `
          WITH moved AS (
            DELETE FROM youtube_good WHERE comment_id::text = ANY($1) RETURNING *
          )
          INSERT INTO youtube_comments SELECT * FROM moved;
          `,
          [ids]
        );
        if (resultGood.rowCount < ids.length) {
          await pool.query(
            `
            WITH moved AS (
              DELETE FROM youtube_bad WHERE comment_id::text = ANY($1) RETURNING *
            )
            INSERT INTO youtube_comments SELECT * FROM moved;
            `,
            [ids]
          );
        }
      } else {
        resultGood = await pool.query(
          `
          WITH moved AS (
            DELETE FROM good_comments WHERE id = ANY($1) RETURNING *
          )
          INSERT INTO comments_api SELECT * FROM moved;
          `,
          [ids]
        );
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
      }
      res.json({ success: true, message: "Bulk undo successful" });
    } catch (error) {
      console.error("Error in bulk undo:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  // --------------------------------------------------
  // 7) Bulk Delete
  // --------------------------------------------------
  app.post("/comments/:type/bulk-delete", async (req, res) => {
    const { type } = req.params;
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    let table;
    if (source === "youtube") {
      table = "youtube_comments";
      if (type === "good") table = "youtube_good";
      if (type === "bad") table = "youtube_bad";
    } else {
      table = "comments_api";
      if (type === "good") table = "good_comments";
      if (type === "bad") table = "bad_comments";
    }
    try {
      const key = source === "youtube" ? "comment_id" : "id";
      await pool.query(`DELETE FROM ${table} WHERE ${key} = ANY($1)`, [ids]);
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
