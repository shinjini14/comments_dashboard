// src/components/ProtectedRoute.js
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ component: Component, allowedRoles, ...rest }) => {
  const { isAuthenticated, userRole } = useAuth();

  if (isAuthenticated === null) {
    // Still checking authentication
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    // Not authenticated, redirect to login page
    return <Navigate to="/" />;
  }

  if (allowedRoles && !allowedRoles.includes(userRole)) {
    // Role does not match, redirect to an unauthorized page or home
    return <Navigate to="/unauthorized" />;
  }

  return <Component {...rest} />;
};

export default ProtectedRoute;
