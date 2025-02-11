import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  TextField,
  InputAdornment,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import {
  ThumbUp,
  ThumbDown,
  Delete,
  Search,
  GTranslateOutlined,
} from "@mui/icons-material";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TwitterIcon from "@mui/icons-material/Twitter";
import { format } from "date-fns";

import { IconButton } from "@mui/material";

const Dashboard = () => {
  const [comments, setComments] = useState([]);
  const [videoMapping, setVideoMapping] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [modalData, setModalData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [translatedComments, setTranslatedComments] = useState({});
  const [translationToggled, setTranslationToggled] = useState({});

 

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [commentsRes, videosRes] = await Promise.all([
          axios.get(`${process.env.REACT_APP_API_URL}/api/comments`),
          axios.get(`${process.env.REACT_APP_API_URL}/api/videos`),
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
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  
  const translateComment = async (commentId, originalComment) => {
    // Check if the comment is already translated, toggle back to original
    if (translationToggled[commentId]) {
      setTranslationToggled((prev) => ({ ...prev, [commentId]: false }));
      return;
    }
  
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/translate`, {
        text: originalComment
      });
  
      if (response.data.translatedText) {
        setTranslatedComments((prev) => ({
          ...prev,
          [commentId]: response.data.translatedText,
        }));
        setTranslationToggled((prev) => ({ ...prev, [commentId]: true }));
      } else {
        alert("Translation failed.");
      }
    } catch (error) {
      console.error("Translation Error:", error);
      alert("Failed to translate the comment.");
    }
  };
  
  
  

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${process.env.REACT_APP_API_URL}/api/comments/${id}`);
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
    if (url.includes("instagram.com"))
      return <InstagramIcon sx={{ color: "#E1306C" }} />;
    if (url.includes("facebook.com"))
      return <FacebookIcon sx={{ color: "#1877F2" }} />;
    if (url.includes("twitter.com"))
      return <TwitterIcon sx={{ color: "#1DA1F2" }} />;
    return null;
  };

  const filteredComments = comments.filter((comment) => {
    const url = videoMapping[comment.video_id];
    return url && url.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const openModal = async (comment) => {
    if (!comment || !comment.video_id) {
      console.error("Invalid comment data:", comment);
      return;
    }
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/comments/${comment.video_id}/details`
      );
      setModalData({ ...response.data, video_id: comment.video_id });
      setIsModalOpen(true);
    } catch (error) {
      console.error("Error fetching comment details:", error);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalData(null);
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
    {
      field: "main_comment",
      headerName: "Message",
      flex: 2,
      renderCell: (params) => (
        <Typography>
          {translationToggled[params.row.id] ? translatedComments[params.row.id] : params.row.main_comment}
        </Typography>
      ),
    },
    
    {
      field: "url",
      headerName: "URL",
      flex: 2,
      renderCell: (params) => {
        const url = videoMapping[params.row.video_id];
        return url ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              openModal(params.row);
            }}
            style={{
              color: "#303f9f",
              textDecoration: "none",
              fontWeight: "bold",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {url}
          </button>
        ) : (
          "N/A"
        );
      },
    },

    {
      field: "updated_at",
      headerName: "Time",
      width: 150,
      renderCell: (params) =>
        params.value
          ? format(new Date(params.value), "dd/MM/yyyy, HH:mm")
          : "N/A",
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
          <IconButton
            color="info"
            onClick={() => translateComment(params.row.id, params.row.main_comment)}
          >
            {translationToggled[params.row.id] ? <GTranslateOutlined sx={{ color: "green" }} /> : <GTranslateOutlined />}
          </IconButton>
          <IconButton color="error" onClick={() => handleDelete(params.row.id)}>
            <Delete />
          </IconButton>
        </Box>
      ),
    }
    
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
        backgroundColor: "#fff",
        minHeight: "100vh",
      }}
    >
      <AppBar position="fixed" sx={{ backgroundColor: "#303f9f" }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Comments Dashboard
          </Typography>
          <Button variant="outlined" color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          marginTop: "80px",
          marginBottom: "28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingX: 4,
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: "bold", color: "#303f9f" }}>
          Comments Overview
        </Typography>
        <TextField
          variant="outlined"
          placeholder="Search by URL"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: "gray" }} />
              </InputAdornment>
            ),
            style: {
              height: "36px", // Reduced height
              fontSize: "14px", // Adjusted font size
            },
          }}
          sx={{
            width: "300px", // Adjusted width for compactness
            height: "36px", // Reduced height
            backgroundColor: "#fff", // Updated background color
            borderRadius: "10px", // Rounded edges for a sleek look
            boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.2)", // Subtle shadow
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "#ccc", // Light border color
            },
          }}
        />
      </Box>

      <Box sx={{ paddingX: 4 }}>
        <DataGrid
          rows={filteredComments}
          columns={columns}
          pageSize={10}
          getRowId={(row) => row.id}
          sx={{
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: "#e0e0e0",
              fontWeight: "bold",
              color: "#303f9f",
            },
            "& .MuiDataGrid-row": {
              "&:nth-of-type(odd)": {
                backgroundColor: "#f9f9f9",
              },
            },
            border: "none",
          }}
        />
      </Box>

      {modalData && (
        <Dialog open={isModalOpen} onClose={closeModal} maxWidth="md" fullWidth>
          <DialogTitle
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="h6">Comment Thread</Typography>
            <Button onClick={closeModal} color="primary">
              Close
            </Button>
          </DialogTitle>
          <DialogContent>
            {/* Main Comment with User */}
            <Typography variant="h6" gutterBottom>
              <strong>{modalData.main_comment_user}</strong>:{" "}
              {modalData.main_comment}
            </Typography>

            {/* Video Preview */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                aspectRatio: "16/9",
                backgroundColor: "#000",
                marginBottom: 2,
              }}
            >
              {modalData.preview ? (
                <img
                  src={modalData.preview}
                  alt="Video Preview"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <Typography sx={{ color: "#fff" }}>
                  Video Preview Not Available
                </Typography>
              )}
            </Box>

            {/* Video URL */}
            <Typography variant="subtitle1" gutterBottom>
              URL:{" "}
              {videoMapping[modalData.video_id] ? (
                <a
                  href={videoMapping[modalData.video_id]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#303f9f",
                    textDecoration: "none",
                    fontWeight: "bold",
                  }}
                >
                  {videoMapping[modalData.video_id]}
                </a>
              ) : (
                "URL Not Available"
              )}
            </Typography>

            {/* Replies */}
            <Typography variant="subtitle1" gutterBottom>
              Replies:
            </Typography>
            <Box sx={{ paddingLeft: 2 }}>
              {modalData.replies.length > 0 ? (
                modalData.replies.map((reply, index) => (
                  <Typography key={index} variant="body2" gutterBottom>
                    <strong>{reply.reply_user}</strong>: {reply.reply}
                  </Typography>
                ))
              ) : (
                <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                  No replies available.
                </Typography>
              )}
            </Box>
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
};

export default Dashboard;
