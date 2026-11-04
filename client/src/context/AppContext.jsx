import { createContext, useContext, useState } from "react";
import toast from "react-hot-toast";
import api from "../config/api";

const AppContext = createContext();

const getErrMsg = (err, fallback) => err.response?.data?.error || fallback;

export const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  // Auth Action helper
  const authAction = async (requestFn, successMsg, errorFallback) => {
    try {
      const { data } = await requestFn();
      setUser(data.user);
      if (successMsg) toast.success(successMsg);
      return true;
    } catch (error) {
      toast.error(getErrMsg(err, errorFallback));
      return false;
    }
  };

  const login = (email, password) => {
    return authAction(
      () => api.post("/api/auth/login", { email, password }),
      "Welcome back!",
      "Login Failed",
    );
  };

  const register = (name, email, password) => {
    return authAction(
      () => api.post("/api/auth/register", { name, email, password }),
      "Account Created Successfully!",
      "Registration Failed",
    );
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
      setUser(null);
      toast.success("Logout Successfully");
    } catch (error) {
      toast.error("Logout error");
    }
  };

  const value = {
    user,
    setUser,
    login,
    register,
    logout,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => useContext(AppContext);
