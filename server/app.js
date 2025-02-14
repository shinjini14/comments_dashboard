require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const pool = require("./db"); // PostgreSQL connection
const cors = require("cors");
const path = require("path");
const { Translate } = require("@google-cloud/translate").v2;

// Load Google service account credentials from Vercel's environment variable
const credentials = JSON.parse(process.env.GOOGLE_AUTH);
const translate = new Translate({ credentials });


const app = express();
const PORT = 5000;



// Middleware
app.use(express.json());
app.use(cors());



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


  app.post("/api/comments/analyze", async (req, res) => {
    try {
      console.log("📢 Starting sentiment analysis for comments...");
  
      // Fetch all comments that don't have a sentiment_tag
      const { rows: comments } = await pool.query("SELECT id, main_comment FROM comments_api WHERE sentiment_tag IS NULL");
  
      if (comments.length === 0) {
        console.log("✅ No new comments to analyze.");
        return res.json({ message: "No new comments to analyze." });
      }
  
      console.log(`✅ Fetched ${comments.length} new comments from the database.`);
      console.log("📥 Comments Data:", comments);
  
      // Step 1: Detect and translate non-English comments
      let translatedComments = [];
      for (const comment of comments) {
        try {
          // Detect language
          const [detection] = await translate.detect(comment.main_comment);
          if (detection.language !== "en") {
            console.log(`🌍 Translating comment ID ${comment.id} from ${detection.language} to English...`);
            const [translated] = await translate.translate(comment.main_comment, "en");
            translatedComments.push({ id: comment.id, text: translated });
          } else {
            console.log(`✅ Comment ID ${comment.id} is already in English. Sending as-is.`);
            translatedComments.push({ id: comment.id, text: comment.main_comment });
          }
        } catch (translateError) {
          console.error(`❌ Translation failed for comment ID ${comment.id}:`, translateError);
          translatedComments.push({ id: comment.id, text: comment.main_comment }); // Use original text if translation fails
        }
      }
  
      console.log("📤 Sending translated comments to prediction API:", JSON.stringify(translatedComments, null, 2));
  
      // Step 2: Send translated comments for sentiment analysis
      const apiPayload = { comments: translatedComments.map((c) => c.text) };
  
      let response;
      try {
        response = await axios.post("http://34.66.186.236/api/v0/get_comments_prediction", apiPayload);
        console.log("📥 Received response from prediction API:", JSON.stringify(response.data, null, 2));
      } catch (apiError) {
        console.error("❌ Error calling prediction API:", apiError.response ? apiError.response.data : apiError);
        return res.status(500).json({ error: "Failed to connect to sentiment prediction API." });
      }
  
      // Step 3: Validate API response
      if (!response.data.success || !response.data.comments) {
        console.error("❌ Prediction API returned an invalid response:", response.data);
        return res.status(500).json({ error: "Invalid response from sentiment prediction API." });
      }
  
      const predictions = response.data.comments;
      console.log("✅ Sentiment Predictions Received:", predictions);
  
      // Step 4: Validate the predictions length matches the number of comments
      if (predictions.length !== translatedComments.length) {
        console.error(`❌ Mismatch: Expected ${translatedComments.length} predictions but got ${predictions.length}`);
        return res.status(500).json({ error: "Mismatch in prediction results." });
      }
  
      // Step 5: Update sentiment_tag column in the database
      for (let i = 0; i < translatedComments.length; i++) {
        const sentimentTag = predictions[i] === "negative" ? "bad" : "good";
  
        try {
          await pool.query("UPDATE comments_api SET sentiment_tag = $1 WHERE id = $2", [
            sentimentTag,
            translatedComments[i].id,
          ]);
          console.log(`✅ Updated comment ID ${translatedComments[i].id} as '${sentimentTag}'`);
        } catch (updateError) {
          console.error(`❌ Error updating comment ID ${translatedComments[i].id}:`, updateError);
        }
      }
  
      console.log("🎉 Sentiment analysis and database update completed successfully.");
      res.json({ message: "Sentiment analysis updated successfully." });
  
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
  