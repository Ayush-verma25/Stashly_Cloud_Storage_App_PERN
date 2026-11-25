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
  const [filesPagination, setFilesPagination] = useState({
    page: 1,
    limit: 50,
    totalFiles: 0,
    totalPages: 0,
  });
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const driveRequestId = useRef(0);
  const [loadedDrive, setLoadedDrive] = useState(null);

  const setAuthenticatedUser = useCallback((nextUser) => {
    const previousUser = userRef.current;
    if (previousUser?.id !== nextUser?.id) {
      driveRequestId.current += 1;
      setCurrentFolderId(null);
      setBreadCrumbs(ROOT_BREADCRUMB);
      setFolders([]);
      setFiles([]);
      setFilesPagination({ page: 1, limit: 50, totalFiles: 0, totalPages: 0 });
      setIsDriveLoading(false);
      setLoadedDrive(null);
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
    } catch (error) {
      if (generation === authGeneration.current) {
        if (error.response?.status === 401) {
          setAuthenticatedUser(null);
          return null;
        }
        toast.error("Unable to verify your session. Check your connection and retry.");
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

  const userId = user?.id;
  const fetchDriveContent = useCallback(
    async (folderId, search, sort, page) => {
      if (!userId || userRef.current?.id !== userId) return;
      const requestId = ++driveRequestId.current;
      setIsDriveLoading(true);
      try {
        const parentParam = folderId || "null";
        const fetchFiles = (requestedPage) =>
          api.get("/api/files", {
            params: { folder_id: parentParam, search, sort, page: requestedPage },
          });
        const [folderRes, firstFileRes, detailRes] = await Promise.all([
          api.get("/api/folders", {
            params: { parent_id: parentParam, search },
          }),
          fetchFiles(page),
          folderId ? api.get(`/api/folders/${folderId}`) : null,
        ]);

        let fileRes = firstFileRes;
        let requestedPage = page;
        while (
          requestId === driveRequestId.current &&
          requestedPage > 1 &&
          fileRes.data.files?.length === 0 &&
          fileRes.data.pagination?.totalPages > 0
        ) {
          requestedPage = Math.min(requestedPage - 1, fileRes.data.pagination.totalPages);
          fileRes = await fetchFiles(requestedPage);
        }
        if (requestId !== driveRequestId.current) return;
        setLoadedDrive({ folderId, search, sort });

        setFolders(folderRes.data.folders || []);
        setFiles(fileRes?.data?.files || []);
        const pagination = fileRes.data.pagination || {
          page: 1, limit: 50, totalFiles: 0, totalPages: 0,
        };
        setFilesPagination(pagination.totalPages ? pagination : { ...pagination, page: 1 });
        setBreadCrumbs(
          detailRes?.data?.folder
            ? detailRes.data.breadcrumbs || ROOT_BREADCRUMB
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
    [userId],
  );

  const isDisplayedDriveCurrent =
    loadedDrive?.folderId === currentFolderId &&
    loadedDrive?.search === searchQuery &&
    loadedDrive?.sort === sortBy;
  const refreshPage = isDisplayedDriveCurrent ? filesPagination.page : 1;
  const activeDrive = useRef(null);
  useLayoutEffect(() => {
    activeDrive.current = {
      folderId: currentFolderId, searchQuery, sortBy, page: refreshPage, fetchDriveContent,
    };
  }, [currentFolderId, searchQuery, sortBy, refreshPage, fetchDriveContent]);

  const refreshDrive = useCallback((folderId) => {
    const drive = activeDrive.current;
    if (drive?.folderId === (folderId || null)) {
      return drive.fetchDriveContent(drive.folderId, drive.searchQuery, drive.sortBy, drive.page);
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
    refreshDrive,
    currentFolderId,
    setCurrentFolderId,
    breadsCrumbs,
    folders,
    setFolders,
    files,
    setFiles,
    filesPagination,
    isDriveLoading,
    isDisplayedDriveCurrent,
    fetchDriveContent,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => useContext(AppContext);
