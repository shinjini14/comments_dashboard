import React, { createContext, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { jwtDecode } from "jwt-decode"; // Ensure correct import

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();

  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem("token"));
  const [userRole, setUserRole] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token).role : null;
  });

  // Handle Login
  const login = async (username, password) => {
    try {
      const response = await axios.post("/api/auth/login", { username, password });
      const { success, token } = response.data;

      if (success) {
        localStorage.setItem("token", token);
        const decodedToken = jwtDecode(token);
        const role = decodedToken.role;

        setIsAuthenticated(true);
        setUserRole(role);

        navigate("/dashboard"); // Redirect to dashboard upon success
      } else {
        alert("Invalid credentials");
      }
    } catch (error) {
      console.error("Login error:", error);
      alert("Login failed. Please try again.");
    }
  };

  // Handle Logout
  const logout = () => {
    localStorage.removeItem("token");
    setIsAuthenticated(false);
    setUserRole(null);
    navigate("/login"); // Redirect back to login
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated, userRole, setUserRole, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
