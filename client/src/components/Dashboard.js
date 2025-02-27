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
  const [translationModal, setTranslationModal] = useState({
    open: false,
    translatedText: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

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

  const translateComment = async (commentId, originalComment) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/translate`,
        {
          text: originalComment,
        }
      );

      if (response.data.translatedText) {
        setTranslationModal({
          open: true,
          translatedText: response.data.translatedText,
        });
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

  const filteredAndSortedComments = [...comments]
    .filter((comment) => {
      const url = videoMapping[comment.video_id];
      return url && url.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      if (a.sentiment_tag === "bad" && b.sentiment_tag !== "bad") return -1;
      if (a.sentiment_tag !== "bad" && b.sentiment_tag === "bad") return 1;
      return 0;
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

      const structuredData = {
        main_comment_user: comment.main_comment_user,
        main_comment: comment.main_comment,
        preview: response.data.preview || null,
        video_id: comment.video_id,
        replies: response.data.replies || [], // Ensure replies are mapped properly
        sentiment_tag: comment.sentiment_tag, // Add sentiment for styling
      };

      setModalData(structuredData);
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
        <Typography
          onClick={() => openModal(params.row)}
          sx={{
            whiteSpace: "normal",
            wordBreak: "break-word",
            overflowWrap: "break-word",
            cursor: "pointer",
            color: "#000",
            "&:hover": {
              textDecoration: "none",
            },
          }}
        >
          {params.row.main_comment}
        </Typography>
      ),
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
      field: "sentiment_tag",
      headerName: "Sentiment",
      flex: 1,
      renderCell: (params) => (
        <Box
          sx={{
            display: "inline-flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "2px 8px", // Reduce padding for a smaller look
            borderRadius: "12px", // Keeps it pill-shaped but smaller
            backgroundColor:
              params.row.sentiment_tag === "bad"
                ? "rgba(211, 47, 47, 0.15)"
                : "rgba(56, 142, 60, 0.15)", // Softer background
            color: params.row.sentiment_tag === "bad" ? "#D32F2F" : "#388E3C", // Keep color distinct
            fontWeight: "500",
            fontSize: "12px", // Make the text smaller
            textTransform: "capitalize",
            textAlign: "center",
            minWidth: "50px", // Keeps consistency without taking too much space
            maxHeight: "20px", // Ensures it doesn't stretch the cell
          }}
        >
          {params.row.sentiment_tag}
        </Box>
      ),
    },

    {
      field: "actions",
      headerName: "Actions",
      flex: 1,
      renderCell: (params) => (
        <Box
          sx={{
            display: "box",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px", // Reduced spacing between icons
          }}
        >
          <IconButton color="primary" sx={{ fontSize: "14px", padding: "4px" }}>
            <ThumbUp sx={{ fontSize: "20px" }} />
          </IconButton>
          <IconButton
            color="secondary"
            sx={{ fontSize: "14px", padding: "4px" }}
          >
            <ThumbDown sx={{ fontSize: "20px" }} />
          </IconButton>
          <IconButton
            color="info"
            sx={{ fontSize: "14px", padding: "4px" }}
            onClick={() =>
              translateComment(params.row.id, params.row.main_comment)
            }
          >
            <GTranslateOutlined sx={{ fontSize: "20px" }} />
          </IconButton>
          <IconButton
            color="error"
            sx={{ fontSize: "14px", padding: "4px" }}
            onClick={() => handleDelete(params.row.id)}
          >
            <Delete sx={{ fontSize: "20px" }} />
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
          rows={filteredAndSortedComments}
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
      <Dialog
        open={translationModal.open}
        onClose={() => setTranslationModal({ open: false, translatedText: "" })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ backgroundColor: "#303f9f", color: "#fff" }}>
          Translated Comment
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "18px", color: "#333", padding: "10px" }}>
            {translationModal.translatedText}
          </Typography>
        </DialogContent>
        <Button
          onClick={() =>
            setTranslationModal({ open: false, translatedText: "" })
          }
          sx={{ alignSelf: "flex-end", margin: "10px" }}
        >
          Close
        </Button>
      </Dialog>

      {modalData && (
  <Dialog 
    open={isModalOpen} 
    onClose={closeModal} 
    maxWidth="xs" // Compact size like Instagram post
    fullWidth
    sx={{
      "& .MuiDialog-paper": {
        borderRadius: "12px",
        boxShadow: "0px 6px 16px rgba(0, 0, 0, 0.2)",
        padding: "10px",
      },
    }}
  >
    {/* Header */}
    <DialogTitle
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid #ddd",
      }}
    >
      <Typography variant="h6" fontWeight="bold">Comment Thread</Typography>
      <IconButton onClick={closeModal} sx={{ color: "#555" }}>
        ✖
      </IconButton>
    </DialogTitle>

    {/* Content */}
    <DialogContent sx={{ padding: "16px" }}>
      {/* Main Comment */}
      <Box sx={{ marginBottom: "14px" }}>
        <Typography variant="body1" sx={{ fontSize: "15px", lineHeight: "1.5" }}>
          <strong>{modalData.main_comment_user}</strong>: {modalData.main_comment}
        </Typography>
      </Box>

      {/* Video Preview with 4:5 Instagram Aspect Ratio */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          aspectRatio: "4/5",
          backgroundColor: "#000",
          borderRadius: "10px",
          overflow: "hidden",
          marginBottom: "16px",
        }}
      >
        {modalData.preview ? (
          <img
            src={modalData.preview}
            alt="Video Preview"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <Typography sx={{ color: "#fff", textAlign: "center" }}>
            Video Preview Not Available
          </Typography>
        )}
      </Box>

      {/* Video URL */}
      <Box sx={{ marginBottom: "14px" }}>
        <Typography variant="subtitle2" sx={{ fontSize: "14px", color: "#555" }}>
          <strong>URL:</strong>{" "}
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
      </Box>

      {/* Sentiment/Status */}
      <Box sx={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <Typography
          variant="body2"
          sx={{
            fontSize: "14px",
            fontWeight: "bold",
            padding: "6px 12px",
            borderRadius: "12px",
            textAlign: "center",
            backgroundColor:
              modalData.sentiment_tag === "bad" ? "rgba(211, 47, 47, 0.15)" : "rgba(56, 142, 60, 0.15)",
            color: modalData.sentiment_tag === "bad" ? "#D32F2F" : "#388E3C",
          }}
        >
          {modalData.sentiment_tag.toUpperCase()}
        </Typography>
      </Box>

      {/* Replies Section - **NOW FILTERED CORRECTLY** */}
      <Typography variant="subtitle1" sx={{ fontWeight: "bold", fontSize: "14px", marginBottom: "10px" }}>
        Replies:
      </Typography>
      <Box sx={{ paddingLeft: "12px", maxHeight: "200px", overflowY: "auto" }}>
        {modalData.replies.filter(reply => reply.main_comment_id === modalData.video_id).length > 0 ? (
          modalData.replies
            .filter(reply => reply.main_comment_id === modalData.video_id) // ✅ **Fix: Only show replies for this comment**
            .map((reply, index) => (
              <Box key={index} sx={{ marginBottom: "12px" }}>
                <Typography variant="body2" sx={{ fontSize: "13px", fontWeight: "bold", marginBottom: "4px" }}>
                  {reply.reply_user}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: "13px", color: "#333" }}>
                  {reply.reply}
                </Typography>
              </Box>
            ))
        ) : (
          <Typography variant="body2" sx={{ fontStyle: "italic", color: "#777" }}>
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
