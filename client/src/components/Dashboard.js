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
  Tabs,
  Tab,
  IconButton,
  DialogActions,
  Paper,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import {
  ThumbUp,
  ThumbDown,
  Search,
  GTranslateOutlined,
  DeleteOutline,
  YouTube as YouTubeIcon,
} from "@mui/icons-material";
import UndoIcon from "@mui/icons-material/Undo";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TwitterIcon from "@mui/icons-material/Twitter";
import { format } from "date-fns";

const Dashboard = () => {
  // -------------------------------------------------
  // 1. State
  // -------------------------------------------------
  const [allComments, setAllComments] = useState({
    main: [],
    good: [],
    bad: [],
  });
  const [videoMapping, setVideoMapping] = useState({});
  const [selectedDashboard, setSelectedDashboard] = useState("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Modals
  const [modalData, setModalData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [translationModal, setTranslationModal] = useState({
    open: false,
    translatedText: "",
  });

  // DataGrid selection
  const [rowSelectionModel, setRowSelectionModel] = useState([]);

  // Bulk & single-delete dialogs
  const [bulkDialog, setBulkDialog] = useState({ open: false, action: "" });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null });



  // Helper to parse time safely
  const getTimeMs = (row) => {
    // Row might have updated_at or time
    const raw = row.updated_at || row.time;
    if (!raw) return 0; // no date => fallback
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  // Sort so that 'bad' is first, then by descending time
  const sortComments = (arr) => {
    return arr.slice().sort((a, b) => {
      // 1) 'bad' first
      if (a.sentiment_tag === "bad" && b.sentiment_tag !== "bad") return -1;
      if (b.sentiment_tag === "bad" && a.sentiment_tag !== "bad") return 1;
      // 2) then by descending date/time
      return getTimeMs(b) - getTimeMs(a);
    });
  };

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch standard and YouTube endpoints for main, good, and bad comments.
      const [
        mainStd,
        mainYt,
        goodStd,
        goodYt,
        badStd,
        badYt,
        videosRes,
      ] = await Promise.all([
        axios.get(`${process.env.REACT_APP_API_URL}/comments/main`),
        axios.get(`${process.env.REACT_APP_API_URL}/comments/main?source=youtube`),
        axios.get(`${process.env.REACT_APP_API_URL}/comments/good`),
        axios.get(`${process.env.REACT_APP_API_URL}/comments/good?source=youtube`),
        axios.get(`${process.env.REACT_APP_API_URL}/comments/bad`),
        axios.get(`${process.env.REACT_APP_API_URL}/comments/bad?source=youtube`),
        axios.get(`${process.env.REACT_APP_API_URL}/api/videos`),
      ]);

      // Merge results and tag rows with a "source" property.
      const mainCombined = [
        ...mainStd.data.map((row) => ({ ...row, source: "default" })),
        ...mainYt.data.map((row) => ({
          ...row,
          source: "youtube",
          video_id: row.video_db_id, // Remap youtube row's video_db_id to video_id
          main_comment: row.text,    // Remap from "text"
          main_comment_user: row.author, // Remap from "author"
        })),
      ];
      const goodCombined = [
        ...goodStd.data.map((row) => ({ ...row, source: "default" })),
        ...goodYt.data.map((row) => ({
          ...row,
          source: "youtube",
          video_id: row.video_db_id,
          main_comment: row.text,
          main_comment_user: row.author,
        })),
      ];
      const badCombined = [
        ...badStd.data.map((row) => ({ ...row, source: "default" })),
        ...badYt.data.map((row) => ({
          ...row,
          source: "youtube",
          video_id: row.video_db_id,
          main_comment: row.text,
          main_comment_user: row.author,
        })),
      ];

      // Sort each array so that 'bad' is first, then by descending time.
      // (Assuming you have a sortComments function as in your code.)
      const sortedMain = sortComments(mainCombined);
      const sortedGood = sortComments(goodCombined);
      const sortedBad = sortComments(badCombined);

      setAllComments({
        main: sortedMain,
        good: sortedGood,
        bad: sortedBad,
      });

      // Build video mapping: id => url.
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
  }, []); // No dependencies, so fetchAllData is memoized

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const currentComments = allComments[selectedDashboard] || [];

  // Unique row ID
  const getRowId = (row) => row.id || row.comment_id || row.video_id;

  // -------------------------------------------------
  // 3. Single Approve/Reject/Undo/Delete
  // -------------------------------------------------
  const approveComment = async (id, source = "default") => {
    try {
      const queryParam = source === "youtube" ? "?source=youtube" : "";
      await axios.post(`${process.env.REACT_APP_API_URL}/approve/${id}${queryParam}`);
      // Move from main => good
      const item = allComments.main.find((c) => getRowId(c) === id);
      if (item) {
        setAllComments((prev) => ({
          ...prev,
          main: prev.main.filter((c) => getRowId(c) !== id),
          good: [item, ...prev.good],
        }));
      }
    } catch (error) {
      console.error("Error approving comment:", error);
    }
  };

  const rejectComment = async (id, source = "default") => {
    try {
      const queryParam = source === "youtube" ? "?source=youtube" : "";
      await axios.post(`${process.env.REACT_APP_API_URL}/reject/${id}${queryParam}`);
      // Move from main => bad
      const item = allComments.main.find((c) => getRowId(c) === id);
      if (item) {
        setAllComments((prev) => ({
          ...prev,
          main: prev.main.filter((c) => getRowId(c) !== id),
          bad: [item, ...prev.bad],
        }));
      }
    } catch (error) {
      console.error("Error rejecting comment:", error);
    }
  };

  const undoComment = async (id, source = "default") => {
    try {
      const queryParam = source === "youtube" ? "?source=youtube" : "";
      await axios.post(`${process.env.REACT_APP_API_URL}/undo/${id}${queryParam}`);
      // Move from good/bad => main
      const itemGood = allComments.good.find((c) => getRowId(c) === id);
      if (itemGood) {
        setAllComments((prev) => ({
          ...prev,
          good: prev.good.filter((c) => getRowId(c) !== id),
          main: [itemGood, ...prev.main],
        }));
        return;
      }
      const itemBad = allComments.bad.find((c) => getRowId(c) === id);
      if (itemBad) {
        setAllComments((prev) => ({
          ...prev,
          bad: prev.bad.filter((c) => getRowId(c) !== id),
          main: [itemBad, ...prev.main],
        }));
      }
    } catch (error) {
      console.error("Error undoing comment:", error);
    }
  };

  const handleSingleDelete = (id) => {
    setDeleteDialog({ open: true, id });
  };
  const confirmSingleDelete = async () => {
    try {
      const { id } = deleteDialog;
      await axios.delete(
        `${process.env.REACT_APP_API_URL}/comments/${selectedDashboard}/${id}`
      );
      setAllComments((prev) => ({
        ...prev,
        [selectedDashboard]: prev[selectedDashboard].filter(
          (c) => getRowId(c) !== id
        ),
      }));
    } catch (error) {
      console.error("Error deleting comment:", error);
    } finally {
      setDeleteDialog({ open: false, id: null });
    }
  };

  // -------------------------------------------------
  // 4. Bulk Actions
  // -------------------------------------------------
  const handleBulkAction = (action) => setBulkDialog({ open: true, action });
  const confirmBulkAction = async () => {
    try {
      if (bulkDialog.action === "approve") {
        await axios.post(`${process.env.REACT_APP_API_URL}/bulk/approve`, {
          ids: rowSelectionModel,
        });
        const approvedItems = allComments.main.filter((c) =>
          rowSelectionModel.includes(getRowId(c))
        );
        setAllComments((prev) => ({
          ...prev,
          main: prev.main.filter((c) => !rowSelectionModel.includes(getRowId(c))),
          good: [...approvedItems, ...prev.good],
        }));
      } else if (bulkDialog.action === "reject") {
        await axios.post(`${process.env.REACT_APP_API_URL}/bulk/reject`, {
          ids: rowSelectionModel,
        });
        const rejectedItems = allComments.main.filter((c) =>
          rowSelectionModel.includes(getRowId(c))
        );
        setAllComments((prev) => ({
          ...prev,
          main: prev.main.filter((c) => !rowSelectionModel.includes(getRowId(c))),
          bad: [...rejectedItems, ...prev.bad],
        }));
      } else if (bulkDialog.action === "delete") {
        await axios.post(
          `${process.env.REACT_APP_API_URL}/comments/${selectedDashboard}/bulk-delete`,
          { ids: rowSelectionModel }
        );
        setAllComments((prev) => ({
          ...prev,
          [selectedDashboard]: prev[selectedDashboard].filter(
            (c) => !rowSelectionModel.includes(getRowId(c))
          ),
        }));
      } else if (bulkDialog.action === "undo") {
        await axios.post(`${process.env.REACT_APP_API_URL}/bulk/undo`, {
          ids: rowSelectionModel,
        });
        const undoneGood = allComments.good.filter((c) =>
          rowSelectionModel.includes(getRowId(c))
        );
        const undoneBad = allComments.bad.filter((c) =>
          rowSelectionModel.includes(getRowId(c))
        );
        setAllComments((prev) => ({
          ...prev,
          good: prev.good.filter((c) => !rowSelectionModel.includes(getRowId(c))),
          bad: prev.bad.filter((c) => !rowSelectionModel.includes(getRowId(c))),
          main: [...undoneGood, ...undoneBad, ...prev.main],
        }));
      }
    } catch (error) {
      console.error(`Error in bulk ${bulkDialog.action}:`, error);
    } finally {
      setBulkDialog({ open: false, action: "" });
      setRowSelectionModel([]);
    }
  };

  // -------------------------------------------------
  // 5. Translation
  // -------------------------------------------------
  const translateComment = async (commentId, originalComment) => {
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/translate`, {
        text: originalComment,
      });
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

  // -------------------------------------------------
  // 6. Comment Thread Modal
  // -------------------------------------------------
  const openModal = async (comment) => {
    if (!comment || !comment.video_id) return;
    try {
      const queryParam = comment.source === "youtube" ? "?source=youtube" : "";
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/comments/${comment.video_id}/details${queryParam}`
      );
      setModalData({
        main_comment_user: comment.main_comment_user,
        main_comment: comment.main_comment,
        preview: response.data.preview || null,
        video_id: comment.video_id,
        replies: response.data.replies || [],
        sentiment_tag: comment.sentiment_tag,
        source: comment.source,
      });
      setIsModalOpen(true);
    } catch (error) {
      console.error("Error fetching comment details:", error);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalData(null);
  };

  // -------------------------------------------------
  // 7. DataGrid Columns
  // -------------------------------------------------
  const columns = [
    {
      field: "platform",
      headerName: "Page",
      flex: 0.5,
      renderCell: (params) => {
        const row = params.row;
        const url = videoMapping[row.video_id];
        // YouTube icon if source = youtube
        if (row.source === "youtube") {
          return <YouTubeIcon sx={{ color: "#FF0000" }} />;
        }
        // Otherwise, check standard
        if (!url) return null;
        if (url.includes("instagram.com")) return <InstagramIcon sx={{ color: "#E1306C" }} />;
        if (url.includes("facebook.com")) return <FacebookIcon sx={{ color: "#1877F2" }} />;
        if (url.includes("twitter.com")) return <TwitterIcon sx={{ color: "#1DA1F2" }} />;
        return null;
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
            cursor: "pointer",
            color: "#000",
            "&:hover": { textDecoration: "underline" },
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
      renderCell: (params) => {
        // For YouTube rows, we might have updated_at from the joined stats table, or time from the row
        const timeValue = params.row.updated_at || params.row.time;
        if (!timeValue) return "N/A";
        // Safely parse
        const ms = new Date(timeValue).getTime();
        if (Number.isNaN(ms)) return "N/A";
        return format(new Date(ms), "dd/MM/yyyy, HH:mm");
      },
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
            padding: "2px 8px",
            borderRadius: "12px",
            backgroundColor:
              params.row.sentiment_tag === "bad"
                ? "rgba(211,47,47,0.15)"
                : "rgba(56,142,60,0.15)",
            color: params.row.sentiment_tag === "bad" ? "#D32F2F" : "#388E3C",
            fontWeight: 500,
            fontSize: "12px",
            textTransform: "capitalize",
            minWidth: "50px",
            maxHeight: "20px",
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
      renderCell: (params) => {
        const row = params.row;
        const id = getRowId(row);
        const source = row.source || "default";
        return (
          <Box sx={{ display: "flex", gap: "4px" }}>
            {selectedDashboard === "main" && (
              <>
                <IconButton
                  color="primary"
                  size="small"
                  title="Approve"
                  onClick={() => approveComment(id, source)}
                >
                  <ThumbUp fontSize="small" />
                </IconButton>
                <IconButton
                  color="secondary"
                  size="small"
                  title="Reject"
                  onClick={() => rejectComment(id, source)}
                >
                  <ThumbDown fontSize="small" />
                </IconButton>
              </>
            )}
            {(selectedDashboard === "good" || selectedDashboard === "bad") && (
              <IconButton
                color="info"
                size="small"
                title="Undo"
                onClick={() => undoComment(id, source)}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            )}
            <IconButton
              color="error"
              size="small"
              title="Delete"
              onClick={() => handleSingleDelete(id)}
            >
              <DeleteOutline fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              title="Translate"
              onClick={() => translateComment(id, row.main_comment)}
            >
              <GTranslateOutlined fontSize="small" />
            </IconButton>
          </Box>
        );
      },
    },
  ];

  // -------------------------------------------------
  // 8. Rendering
  // -------------------------------------------------
  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress size={60} />
      </Box>
    );
  }

  // Filter by URL
  const filteredComments = currentComments.filter((comment) => {
    const url = videoMapping[comment.video_id];
    return url && url.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <Box sx={{ backgroundColor: "#fff", minHeight: "100vh", pb: 4 }}>
      {/* Top Bar */}
      <AppBar position="fixed" sx={{ backgroundColor: "#3949ab" }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Comments Dashboard
          </Typography>
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => {
              localStorage.clear();
              window.location.href = "/";
            }}
          >
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      {/* Tabs */}
      <Box sx={{ mt: "60px", px: 2 }}>
        <Tabs
          value={selectedDashboard}
          onChange={(e, newValue) => {
            setSelectedDashboard(newValue);
            setRowSelectionModel([]);
          }}
          textColor="primary"
          indicatorColor="primary"
          variant="fullWidth"
          sx={{
            backgroundColor: "#fff",
            borderRadius: "6px",
            mt: "70px",
            boxShadow: "0px 1px 2px rgba(0,0,0,0.1)",
            minHeight: "40px",
            "& .MuiTab-root": {
              minHeight: "40px",
              fontSize: "0.9rem",
              textTransform: "none",
            },
          }}
        >
          <Tab value="main" label="Main Comments" />
          <Tab value="good" label="Approved Comments" />
          <Tab value="bad" label="Rejected Comments" />
        </Tabs>
      </Box>

      {/* Search + Bulk Action Toolbar */}
      <Paper
        elevation={2}
        sx={{
          mt: 2,
          mb: 2,
          mx: 2,
          p: 1.5,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <TextField
          variant="outlined"
          placeholder="Search by URL"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: "#999", fontSize: "18px" }} />
              </InputAdornment>
            ),
          }}
          sx={{
            width: "300px",
            backgroundColor: "#fff",
            borderRadius: "6px",
            "& .MuiOutlinedInput-root": {
              height: "36px",
              fontSize: "0.9rem",
            },
          }}
        />
        <Box sx={{ display: "flex", gap: "8px" }}>
          {selectedDashboard === "main" && (
            <>
              <Button
                variant="contained"
                size="small"
                sx={{
                  backgroundColor: "#1976d2",
                  color: "#fff",
                  textTransform: "none",
                  "&:hover": { backgroundColor: "#1565c0" },
                }}
                disabled={rowSelectionModel.length === 0}
                onClick={() => handleBulkAction("approve")}
              >
                Bulk Approve
              </Button>
              <Button
                variant="contained"
                size="small"
                sx={{
                  backgroundColor: "#9c27b0",
                  color: "#fff",
                  textTransform: "none",
                  "&:hover": { backgroundColor: "#7b1fa2" },
                }}
                disabled={rowSelectionModel.length === 0}
                onClick={() => handleBulkAction("reject")}
              >
                Bulk Reject
              </Button>
            </>
          )}
          {(selectedDashboard === "good" || selectedDashboard === "bad") && (
            <Button
              variant="contained"
              size="small"
              sx={{
                backgroundColor: "#1976d2",
                color: "#fff",
                textTransform: "none",
                "&:hover": { backgroundColor: "#1565c0" },
              }}
              disabled={rowSelectionModel.length === 0}
              onClick={() => handleBulkAction("undo")}
            >
              Bulk Undo
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            sx={{
              backgroundColor: "#e53935",
              color: "#fff",
              textTransform: "none",
              "&:hover": { backgroundColor: "#d32f2f" },
            }}
            disabled={rowSelectionModel.length === 0}
            onClick={() => handleBulkAction("delete")}
          >
            Bulk Delete
          </Button>
        </Box>
      </Paper>

      {/* DataGrid Table */}
      <Box sx={{ px: 2 }}>
        <Paper elevation={3} sx={{ borderRadius: "8px", overflow: "hidden" }}>
          <Box>
            <DataGrid
              rows={filteredComments}
              columns={columns}
              pageSize={10}
              checkboxSelection
              onRowSelectionModelChange={(newModel) => {
                console.log("Selected row IDs:", newModel);
                setRowSelectionModel(newModel);
              }}
              rowSelectionModel={rowSelectionModel}
              getRowId={getRowId}
              disableRowSelectionOnClick
              sx={{
                "& .MuiDataGrid-columnHeaders": {
                  backgroundColor: "#e0e0e0",
                  fontWeight: "bold",
                  color: "#3949ab",
                },
                "& .MuiDataGrid-row:nth-of-type(odd)": {
                  backgroundColor: "#fafafa",
                },
                border: "none",
              }}
            />
          </Box>
        </Paper>
      </Box>

      {/* Translation Modal */}
      <Dialog
        open={translationModal.open}
        onClose={() => setTranslationModal({ open: false, translatedText: "" })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ backgroundColor: "#3949ab", color: "#fff" }}>
          Translated Comment
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "16px", color: "#333", p: 2 }}>
            {translationModal.translatedText}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() =>
              setTranslationModal({ open: false, translatedText: "" })
            }
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Comment Thread Modal */}
      {modalData && (
        <Dialog
          open={isModalOpen}
          onClose={closeModal}
          maxWidth="xs"
          fullWidth
          sx={{
            "& .MuiDialog-paper": {
              borderRadius: "12px",
              boxShadow: "0px 6px 16px rgba(0, 0, 0, 0.2)",
              p: 2,
            },
          }}
        >
          <DialogTitle
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #ddd",
            }}
          >
            <Typography variant="h6" fontWeight="bold">
              Comment Thread
            </Typography>
            <IconButton onClick={closeModal} sx={{ color: "#555" }}>
              ✖
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 2 }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body1" sx={{ fontSize: "15px", lineHeight: "1.5" }}>
                <strong>{modalData.main_comment_user}</strong>: {modalData.main_comment}
              </Typography>
            </Box>
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                aspectRatio: "4/5",
                backgroundColor: "#000",
                borderRadius: "8px",
                overflow: "hidden",
                mb: 2,
              }}
            >
              {modalData.preview ? (
                <img
                  src={modalData.preview}
                  alt="Video Preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <Typography sx={{ color: "#fff", textAlign: "center" }}>
                  Video Preview Not Available
                </Typography>
              )}
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontSize: "14px", color: "#555" }}>
                <strong>URL:</strong>{" "}
                {videoMapping[modalData.video_id] ? (
                  <a
                    href={videoMapping[modalData.video_id]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#303f9f", textDecoration: "none", fontWeight: "bold" }}
                  >
                    {videoMapping[modalData.video_id]}
                  </a>
                ) : (
                  "URL Not Available"
                )}
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography
                variant="body2"
                sx={{
                  fontSize: "14px",
                  fontWeight: "bold",
                  px: 2,
                  py: 1,
                  borderRadius: "12px",
                  backgroundColor:
                    modalData.sentiment_tag === "bad"
                      ? "rgba(211,47,47,0.15)"
                      : "rgba(56,142,60,0.15)",
                  color: modalData.sentiment_tag === "bad" ? "#D32F2F" : "#388E3C",
                }}
              >
                {modalData.sentiment_tag?.toUpperCase()}
              </Typography>
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: "bold", mb: 1 }}>
              Replies:
            </Typography>
            <Box sx={{ pl: 1, maxHeight: "200px", overflowY: "auto" }}>
              {modalData.replies.filter(
                (reply) => reply.main_comment_id === modalData.video_id
              ).length > 0 ? (
                modalData.replies
                  .filter((reply) => reply.main_comment_id === modalData.video_id)
                  .map((reply, index) => (
                    <Box key={index} sx={{ mb: 1 }}>
                      <Typography variant="body2" sx={{ fontSize: "13px", fontWeight: "bold" }}>
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

      {/* Bulk Action Confirmation Dialog */}
      <Dialog open={bulkDialog.open} onClose={() => setBulkDialog({ open: false, action: "" })}>
        <DialogTitle>
          {bulkDialog.action === "approve" && "Confirm Bulk Approve"}
          {bulkDialog.action === "reject" && "Confirm Bulk Reject"}
          {bulkDialog.action === "undo" && "Confirm Bulk Undo"}
          {bulkDialog.action === "delete" && "Confirm Bulk Delete"}
        </DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to <b>{bulkDialog.action}</b> the selected comments?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDialog({ open: false, action: "" })}>Cancel</Button>
          <Button onClick={confirmBulkAction} color="primary">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Single Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({ open: false, id: null })}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to <b>delete</b> this comment?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, id: null })}>Cancel</Button>
          <Button onClick={confirmSingleDelete} color="primary">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Dashboard;
