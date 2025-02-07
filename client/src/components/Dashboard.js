import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Link as MuiLink,
  CircularProgress,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import { ThumbUp, ThumbDown, Delete } from "@mui/icons-material";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TwitterIcon from "@mui/icons-material/Twitter";
import dayjs from "dayjs";

const Dashboard = () => {
  const [comments, setComments] = useState([]);
  const [videoMapping, setVideoMapping] = useState({});
  const [loading, setLoading] = useState(true); // Loading state

  useEffect(() => {
    // Check if the user is authenticated
    const token = localStorage.getItem("token");
    if (!token) {
      // Redirect to login if not authenticated
      window.location.href = "/";
      return;
    }

    const fetchData = async () => {
      try {
        const [commentsRes, videosRes] = await Promise.all([
          axios.get("/api/comments"),
          axios.get("/api/videos"),
        ]);

        setComments(commentsRes.data);

        const mapping = {};
        videosRes.data.forEach((video) => {
          mapping[video.id] = video.url;
        });
        setVideoMapping(mapping);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false); // Stop loading after fetching data
      }
    };

    fetchData();
  }, []);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/comments/${id}`);
      setComments((prev) => prev.filter((comment) => comment.id !== id));
    } catch (error) {
      console.error("Error deleting comment:", error);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    window.location.href = "/";
  };

  const getPlatformIcon = (url) => {
    if (!url) return null;
    if (url.includes("instagram.com")) return <InstagramIcon sx={{ color: "#E1306C" }} />;
    if (url.includes("facebook.com")) return <FacebookIcon sx={{ color: "#1877F2" }} />;
    if (url.includes("twitter.com")) return <TwitterIcon sx={{ color: "#1DA1F2" }} />;
    return null;
  };

  const columns = [
    {
      field: "platform",
      headerName: "Page",
      flex: 0.5,
      renderCell: (params) => {
        const url = videoMapping[params.row.video_id];
        return getPlatformIcon(url);
      },
    },
    { field: "main_comment_user", headerName: "Commenter", flex: 1 },
    { field: "main_comment", headerName: "Message", flex: 2 },
    {
      field: "url",
      headerName: "URL",
      flex: 2,
      renderCell: (params) => {
        const url = videoMapping[params.row.video_id];
        return url ? (
          <MuiLink href={url} target="_blank" rel="noopener" sx={{ color: "#3f51b5", fontWeight: "bold" }}>
            {url}
          </MuiLink>
        ) : (
          "N/A"
        );
      },
    },
    {
      field: "updated_at",
      headerName: "Time",
      flex: 1,
      valueFormatter: (params) => dayjs(params.value).format("MMM DD, YYYY HH:mm"),
    },
    {
      field: "actions",
      headerName: "Actions",
      flex: 1,
      renderCell: (params) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton color="primary">
            <ThumbUp />
          </IconButton>
          <IconButton color="secondary">
            <ThumbDown />
          </IconButton>
          <IconButton color="error" onClick={() => handleDelete(params.row.id)}>
            <Delete />
          </IconButton>
        </Box>
      ),
    },
  ];

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress size={60} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
      
        margin: 0,
        padding: 0,
        overflow: "hidden", // Prevents any scrolling whitespace
      }}
    >
      {/* Header */}
      <AppBar position="fixed" sx={{ backgroundColor: "#3f51b5", boxShadow: "none", margin: 0 }}>
        <Toolbar sx={{ padding: 0 }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, marginLeft: 2 }}>
            Comments Dashboard
          </Typography>
          <Button color="inherit" onClick={handleLogout} sx={{ marginRight: 2 }}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Box
        sx={{
          flexGrow: 1,
          padding: 2,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginTop: "64px", // Adjust for AppBar height
        }}
      >
        <Box
          sx={{
            height: "100vh",
            width: "100%",
            backgroundColor: "#fff",
            borderRadius: 2,
            boxShadow: 3,
          }}
        >
          <DataGrid
          
            rows={comments}
            columns={columns}
            pageSize={10}
            getRowId={(row) => row.id}
            sx={{
              "& .MuiDataGrid-columnHeaders": {
                backgroundColor: "#f0f0f0",
                fontWeight: "bold",
              },
              "& .MuiDataGrid-cell": {
                fontSize: "1rem",
              },
              "& .MuiDataGrid-footerContainer": {
                backgroundColor: "#f0f0f0",
              },
              
            }}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
