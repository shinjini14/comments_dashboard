import axios from "axios";

// ✅ Set the base URL to the deployed backend
const API = axios.create({
  baseURL: "https://comments-dashboard-server.vercel.app/api", // Update this!
});

// API Functions
export const fetchComments = () => API.get("/comments");
export const fetchVideos = () => API.get("/videos");
export const login = (credentials) => API.post("/auth/login", credentials);

export default API;
