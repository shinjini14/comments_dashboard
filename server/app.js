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

// --------------------------------------------------
// 2) Get Comments By Type
//    (Main => comments_api, Good => good_comments, Bad => bad_comments)
// --------------------------------------------------
app.get("/comments/:type", async (req, res) => {
    const { type } = req.params;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    let query = "";
    if (source === "youtube") {
      if (type === "main") {
        // Use a join to fetch updated_at from statistics_youtube_api
        query = `
          SELECT c.*, s.updated_at
          FROM youtube_comments c
          LEFT JOIN statistics_youtube_api s
            ON CAST(c.video_db_id AS VARCHAR(50)) = s.video_id
          ORDER BY (sentiment_tag = 'bad') DESC, s.updated_at DESC
        `;
      } else if (type === "good") {
        // Assuming good_comments for YouTube rows include a source marker (or you may simply return all rows)
        query = `
          SELECT * FROM good_comments
          WHERE source = 'youtube'
          ORDER BY (sentiment_tag = 'bad') DESC, time DESC
        `;
      } else if (type === "bad") {
        query = `
          SELECT * FROM bad_comments
          WHERE source = 'youtube'
          ORDER BY (sentiment_tag = 'bad') DESC, time DESC
        `;
      }
    } else {
      // Default (standard comments)
      let table = "comments_api";
      if (type === "good") table = "good_comments";
      if (type === "bad") table = "bad_comments";
      query = `
        SELECT * FROM ${table}
        ORDER BY (sentiment_tag = 'bad') DESC, updated_at DESC
      `;
    }
    try {
      const result = await pool.query(query);
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
        .map((c) => ({
          reply_user: c.reply_user,
          reply: c.reply,
        }));
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
  
  //
  // 5) APPROVE/REJECT/UNDO SINGLE
  //    For YouTube rows, use the key "comment_id" and append ?source=youtube to the API call.
  //
  app.post("/approve/:id", async (req, res) => {
    const { id } = req.params;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id = $1 RETURNING *
          )
          INSERT INTO good_comments SELECT * FROM moved;
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
            DELETE FROM youtube_comments WHERE comment_id = $1 RETURNING *
          )
          INSERT INTO bad_comments SELECT * FROM moved;
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
        query = `
          WITH moved AS (
            DELETE FROM good_comments WHERE comment_id = $1 RETURNING *
          )
          INSERT INTO youtube_comments SELECT * FROM moved;
        `;
        let result = await pool.query(query, [id]);
        if (result.rowCount === 0) {
          query = `
            WITH moved AS (
              DELETE FROM bad_comments WHERE comment_id = $1 RETURNING *
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
  
  //
  // 6) BULK ACTIONS: APPROVE / REJECT / UNDO
  //
  app.post("/bulk/approve", async (req, res) => {
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    try {
      let moveQuery;
      if (source === "youtube") {
        moveQuery = `
          WITH moved AS (
            DELETE FROM youtube_comments WHERE comment_id = ANY($1) RETURNING *
          )
          INSERT INTO good_comments SELECT * FROM moved;
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
            DELETE FROM youtube_comments WHERE comment_id = ANY($1) RETURNING *
          )
          INSERT INTO bad_comments SELECT * FROM moved;
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
        resultGood = await pool.query(`
          WITH moved AS (
            DELETE FROM good_comments WHERE comment_id = ANY($1) RETURNING *
          )
          INSERT INTO youtube_comments SELECT * FROM moved;
        `, [ids]);
        if (resultGood.rowCount < ids.length) {
          await pool.query(`
            WITH moved AS (
              DELETE FROM bad_comments WHERE comment_id = ANY($1) RETURNING *
            )
            INSERT INTO youtube_comments SELECT * FROM moved;
          `, [ids]);
        }
      } else {
        resultGood = await pool.query(`
          WITH moved AS (
            DELETE FROM good_comments WHERE id = ANY($1) RETURNING *
          )
          INSERT INTO comments_api SELECT * FROM moved;
        `, [ids]);
        if (resultGood.rowCount < ids.length) {
          await pool.query(`
            WITH moved AS (
              DELETE FROM bad_comments WHERE id = ANY($1) RETURNING *
            )
            INSERT INTO comments_api SELECT * FROM moved;
          `, [ids]);
        }
      }
      res.json({ success: true, message: "Bulk undo successful" });
    } catch (error) {
      console.error("Error in bulk undo:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  //
  // 7) BULK DELETE – uses a URL parameter :type ("main", "good", or "bad")
  //     If ?source=youtube is passed, main uses youtube_comments.
  //
  app.post("/comments/:type/bulk-delete", async (req, res) => {
    const { type } = req.params;
    const { ids } = req.body;
    const source = req.query.source === "youtube" ? "youtube" : "default";
    let table;
    if (source === "youtube") {
      table = "youtube_comments";
      if (type === "good") table = "good_comments";
      if (type === "bad") table = "bad_comments";
    } else {
      table = "comments_api";
      if (type === "good") table = "good_comments";
      if (type === "bad") table = "bad_comments";
    }
    try {
      // Use "comment_id" for YouTube and "id" for standard comments.
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
