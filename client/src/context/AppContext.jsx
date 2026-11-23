import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  const userRef = useRef(null);
  const authGeneration = useRef(0);
  const authRequestQueue = useRef(Promise.resolve());
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

  const setAuthenticatedUser = useCallback((nextUser) => {
    const previousUser = userRef.current;
    if (previousUser?.id !== nextUser?.id) {
      driveRequestId.current += 1;
      setCurrentFolderId(null);
      setBreadCrumbs(ROOT_BREADCRUMB);
      setFolders([]);
      setFiles([]);
      setIsDriveLoading(false);
    }
    userRef.current = nextUser;
    setUser(nextUser);
  }, []);

  // Filter & sort State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name_asc");

  // Refresh User Profile & Storage stats
  const refreshUser = useCallback(async () => {
    const generation = authGeneration.current;
    try {
      const { data } = await api.get("/api/auth/me");
      if (generation === authGeneration.current) {
        setAuthenticatedUser(data.user);
        return data.user;
      }
      return userRef.current;
    } catch {
      if (generation === authGeneration.current) {
        setAuthenticatedUser(null);
        return null;
      }
      return userRef.current;
    }
  }, [setAuthenticatedUser]);

  // check Auth Status on App Load
  useEffect(() => {
    refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  // Auth Action helper
  const enqueueAuthRequest = (requestFn) => {
    const queuedRequest = authRequestQueue.current.then(requestFn, requestFn);
    authRequestQueue.current = queuedRequest.then(
      () => undefined,
      () => undefined,
    );
    return queuedRequest;
  };

  const authAction = (requestFn, successMsg, errorFallback) => {
    ++authGeneration.current;
    return enqueueAuthRequest(async () => {
      try {
        const { data } = await requestFn();
        ++authGeneration.current;
        setAuthenticatedUser(data.user);
        if (successMsg) toast.success(successMsg);
        return true;
      } catch (error) {
        toast.error(getErrMsg(error, errorFallback));
        return false;
      }
    });
  };

  const login = (email, password) => {
    return authAction(
      () => api.post("/api/auth/login", { email, password }),
      "Welcome back!",
      "Login Failed",
    );
  };

  const register = async (name, email, password) => {
    try {
      const { data } = await api.post("/api/auth/register", { name, email, password });
      toast.success(data.message);
      return true;
    } catch (error) {
      toast.error(getErrMsg(error, "Registration Failed"));
      return false;
    }
  };

  const logout = () => {
    const generation = ++authGeneration.current;
    return enqueueAuthRequest(async () => {
      try {
        await api.post("/api/auth/logout");
        ++authGeneration.current;
        setAuthenticatedUser(null);
        toast.success("Logout Successfully");
      } catch {
        if (generation === authGeneration.current) toast.error("Logout error");
      }
    });
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

  const activeDrive = useRef(null);
  useLayoutEffect(() => {
    activeDrive.current = { folderId: currentFolderId, fetchDriveContent };
  }, [currentFolderId, fetchDriveContent]);

  const refreshUploadDestination = useCallback((folderId) => {
    const drive = activeDrive.current;
    if (drive?.folderId === (folderId || null)) {
      return drive.fetchDriveContent(folderId);
    }
  }, []);

  const value = {
    user,
    setUser: setAuthenticatedUser,
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
    refreshUploadDestination,
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
