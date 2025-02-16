require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const pool = require("./db"); // PostgreSQL connection
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const { Translate } = require("@google-cloud/translate").v2;

// Load Google service account credentials from Vercel's environment variable
const credentials = JSON.parse(process.env.GOOGLE_AUTH);
const translate = new Translate({ credentials });


const app = express();
const PORT = 5000;



// Middleware
app.use(express.json());
app.use(cors());

// Batch size to process comments in chunks
const BATCH_SIZE = 500; // Process in smaller batches



// Serve the React build
//app.use(express.static(path.join(__dirname, "../client/build")));



// Login API
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

      res.json({
        success: true,
        token,
        role: user.role,
        username: user.username,
      });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Error in /api/auth/login:", error); // Log full error
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// Fetch Comments (Sorted: Bad Comments First)
app.get("/api/comments", async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM comments_api ORDER BY sentiment_tag = 'bad' DESC, updated_at DESC"
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
// Video Metadata API
app.get("/api/videos", async (req, res) => {
    try {
      // Fetch video metadata from the database
      const result = await pool.query("SELECT id, url FROM video");
      
      // Return the data in JSON format
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching videos:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.get("/api/comments/:video_id/details", async (req, res) => {
    const { video_id } = req.params;
  
    try {
      // Fetch main comment and replies
      const { rows: comments } = await pool.query(
        `SELECT 
           main_comment, 
           main_comment_user, 
           reply_user, 
           reply 
         FROM comments_api 
         WHERE video_id = $1`,
        [video_id]
      );
  
      // Fetch video preview from statistics table
      const { rows: video } = await pool.query(
        `SELECT preview 
         FROM statistics 
         WHERE video_id = $1`, // Changed video_preview to preview
        [video_id]
      );
  
      if (comments.length === 0) {
        return res.status(404).json({ error: "No comments found for the video_id" });
      }
  
      const mainComment = comments[0];
      const replies = comments
        .filter((comment) => comment.reply_user && comment.reply)
        .map((comment) => ({
          reply_user: comment.reply_user,
          reply: comment.reply,
        }));
  
      res.json({
        main_comment: mainComment.main_comment,
        main_comment_user: mainComment.main_comment_user,
        video_preview: video.length > 0 ? video[0].preview : null, // Changed video_preview to preview
        replies,
      });
    } catch (error) {
      console.error("Error fetching comment details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });


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
              const [translated] = await translate.translate(comment.main_comment, "en");
              return { id: comment.id, text: translated };
            }
            return { id: comment.id, text: comment.main_comment };
          } catch (error) {
            console.error(`❌ Translation failed for comment ID ${comment.id}:`, error);
            return { id: comment.id, text: comment.main_comment }; // Use original text if translation fails
          }
        })
      );
  
      console.log(`📤 Sending batch of ${translatedComments.length} comments for sentiment analysis...`);
  
      // Step 2: Send translated comments for sentiment analysis
      const apiPayload = { comments: translatedComments.map((c) => c.text) };
      let response;
  
      try {
        response = await axios.post("http://34.66.186.236/api/v0/get_comments_prediction", apiPayload);
        console.log("📥 Received sentiment analysis response.");
      } catch (apiError) {
        console.error("❌ Error calling sentiment API:", apiError.response ? apiError.response.data : apiError);
        return;
      }
  
      if (!response.data.success || !response.data.comments) {
        console.error("❌ Invalid response from sentiment API:", response.data);
        return;
      }
  
      const predictions = response.data.comments;
      if (predictions.length !== translatedComments.length) {
        console.error(`❌ Mismatch: Expected ${translatedComments.length} predictions, got ${predictions.length}`);
        return;
      }
  
      // Step 3: Bulk update sentiment tags in the database
      const updateQuery = `
        UPDATE comments_api SET sentiment_tag = CASE
          ${translatedComments
            .map((c, index) => `WHEN id = ${c.id} THEN '${predictions[index] === "negative" ? "bad" : "good"}'`)
            .join(" ")}
        END
        WHERE id IN (${translatedComments.map((c) => c.id).join(",")});
      `;
  
      try {
        await pool.query(updateQuery);
        console.log(`✅ Successfully updated ${translatedComments.length} comments in the database.`);
      } catch (updateError) {
        console.error("❌ Error updating database:", updateError);
      }
    } catch (error) {
      console.error("❌ Error processing batch:", error);
    }
  };
  
  
  // API Route to Start Processing
  app.post("/api/comments/analyze", async (req, res) => {
    try {
      console.log("📢 Starting sentiment analysis for ALL comments...");
  
      // Fetch all comments from the database (not just untagged ones)
      const { rows: comments } = await pool.query(
        "SELECT id, main_comment FROM comments_api"
      );
  
      if (comments.length === 0) {
        console.log("✅ No comments found.");
        return res.json({ message: "No comments found." });
      }
  
      console.log(`✅ Fetched ${comments.length} comments.`);
  
      // Process all comments in batches asynchronously
      let batchIndex = 1;
      for (let i = 0; i < comments.length; i += BATCH_SIZE) {
        const batch = comments.slice(i, i + BATCH_SIZE);
        console.log(`⏳ Processing batch ${batchIndex}/${Math.ceil(comments.length / BATCH_SIZE)}`);
        await processBatch(batch); // Ensure each batch completes before moving on
        batchIndex++;
      }
  
      console.log("🎉 Sentiment analysis completed.");
      res.json({ message: "Sentiment analysis completed successfully." });
  
    } catch (error) {
      console.error("❌ Error analyzing comments:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  

  // API Route to Translate Comments
app.post("/api/translate", async (req, res) => {
    const { text } = req.body;
  
    if (!text) {
      return res.status(400).json({ error: "No text provided for translation." });
    }
  
    try {
      // Auto-detect the source language & translate to English
      const [translation] = await translate.translate(text, "en");
  
      res.json({ translatedText: translation });
    } catch (error) {
      console.error("Translation Error:", error);
      res.status(500).json({ error: "Translation failed." });
    }
  });
  
  




  //app.get("*", (req, res) => {
    //res.sendFile(path.join(__dirname, "../client/build", "index.html"));
  //});


  
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  