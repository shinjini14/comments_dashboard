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


// Fetch Comments Data for Table
app.get("/api/comments", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM comments_api");
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
  