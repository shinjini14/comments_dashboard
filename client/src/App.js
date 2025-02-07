import React from "react";
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";


import Login from "./components/Login";

import Dashboard from "./components/Dashboard";


const App = () => {
  return (
    <AuthProvider>
     
        <Routes>
          {/* Public routes */}
          
          <Route path="/" element={<Login />} />
          
          <Route
              path="dashboard"
              element={
                <ProtectedRoute
                  component={Dashboard}
                  allowedRoles={["admin"]}
                />
              }
            />


         
         
          
        </Routes>
      
    </AuthProvider>
  );
};

export default App;
