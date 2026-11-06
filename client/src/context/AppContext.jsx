import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import api from "../config/api";

const AppContext = createContext();

const ROOT_BREADCRUMB = [{ id: null, name: "My Drive" }];

const getErrMsg = (err, fallback) => err.response?.data?.error || fallback;

export const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Upload Global State
  const [isUploading, SetIsUploading] = useState(false);
  const [uploadProgress, SetUploadeProgress] = useState(0);

  // Drive View State
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadsCrumbs, setBreadCrumbs] = useState(ROOT_BREADCRUMB);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const driveRequestId = useRef(0);

  // Filter & sort State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name_asc");

  // Refresh User Profile & Storage stats
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  // check Auth Status on App Load
  useEffect(() => {
    refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  // Auth Action helper
  const authAction = async (requestFn, successMsg, errorFallback) => {
    try {
      const { data } = await requestFn();
      setUser(data.user);
      if (successMsg) toast.success(successMsg);
      return true;
    } catch (error) {
      toast.error(getErrMsg(error, errorFallback));
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
    } catch {
      toast.error("Logout error");
    }
  };

  const fetchDriveContent = useCallback(
    async (folderId = currentFolderId, search = searchQuery, sort = sortBy) => {
      if (!user) return;
      const requestId = ++driveRequestId.current;
      setIsDriveLoading(true);
      try {
        const parentParam = folderId || "null";
        const [folderRes, fileRes, detailRes] = await Promise.all([
          api.get("/api/folders", { params: { parent_id: parentParam } }),
          api.get("/api/files", {
            params: { folder_id: parentParam, search, sort },
          }),
          folderId ? api.get(`/api/folders/${folderId}`) : null,
        ]);

        if (requestId !== driveRequestId.current) return;

        setFolders(folderRes.data.folders || []);
        setFiles(fileRes?.data?.files || fileRes?.data?.filse || []);
        setBreadCrumbs(
          detailRes?.data?.folder
            ? [
                ...ROOT_BREADCRUMB,
                ...(detailRes.data.breadcrumbs || []),
                { id: detailRes.data.folder.id, name: detailRes.data.folder.name },
              ]
            : ROOT_BREADCRUMB,
        );
      } catch {
        if (requestId === driveRequestId.current) {
          toast.error("Error loading drive contents");
        }
      } finally {
        if (requestId === driveRequestId.current) {
          setIsDriveLoading(false);
        }
      }
    },
    [user, currentFolderId, searchQuery, sortBy],
  );

  const value = {
    user,
    setUser,
    login,
    register,
    logout,
    isLoading,
    isAuthenticated: !!user,
    isUploading,
    SetIsUploading,
    uploadProgress,
    SetUploadeProgress,
    refreshUser,
    currentFolderId,
    setCurrentFolderId,
    breadsCrumbs,
    folders,
    setFolders,
    files,
    setFiles,
    isDriveLoading,
    fetchDriveContent,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => useContext(AppContext);
