require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const pool = require("./db"); // PostgreSQL connection
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
// Add this before your routes
const allowedOrigins = ["https://comments-dashboard-client.vercel.app"];
app.use(
  cors({
    origin: allowedOrigins,
    methods: "GET,POST,PUT,DELETE",
    credentials: true, // Allow cookies if necessary
  })
);
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



  //app.get("*", (req, res) => {
    //res.sendFile(path.join(__dirname, "../client/build", "index.html"));
  //});


  
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  