import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import api from "../config/api";

const getItemType = (item, itemType) => {
  if (itemType === "folder" || itemType === "file") return itemType;
  if (item?.item_type === "folder" || item?.item_type === "file") {
    return item.item_type;
  }
  if (item?.mime_type) return "file";
  if (item?.path !== undefined) return "folder";
  return null;
};

const isFolderItem = (item, itemType) => getItemType(item, itemType) === "folder";

export function useDrive() {
  const {
    fetchDriveContent,
    refreshUser,
    refreshUploadDestination,
    currentFolderId,
    isUploading,
    SetIsUploading: setIsUploading,
    uploadProgress,
    SetUploadeProgress: setUploadProgress,
  } = useApp();

  // Reusable API  action runner with standerd toast & callback
  const runAction = async (apiCall, successMsg, errorMsg, afterSuccess) => {
    try {
      const res = await apiCall;
      if (successMsg) toast.success(successMsg);
      if (afterSuccess) await afterSuccess(res?.data);
      return true;
    } catch (err) {
      toast.error(err?.response?.data?.error || errorMsg);
      return false;
    }
  };

  // File Upload with request progress
  const uploadFiles = async (fileList, folder_id = currentFolderId) => {
    if (!fileList?.length) return;
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    Array.from(fileList).forEach((f) => formData.append("files", f));
    if (folder_id) formData.append("folder_id", folder_id);

    try {
      const { data } = await api.post("/api/files/upload", formData, {
        onUploadProgress: (event) => {
          if (event.total) {
            setUploadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
          }
        },
      });

      setUploadProgress(100);
      await new Promise((r) => setTimeout(r, 300));
      toast.success(`${data.files.length} file(s) uploaded Successfully!`);
      await Promise.all([refreshUploadDestination(folder_id), refreshUser()]);
    } catch (err) {
      toast.error(err.response?.data?.error || "File upload failed.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Create Folder

  const createFolder = (name, parent_id = currentFolderId) =>
    runAction(
      api.post("/api/folders", { name, parent_id }),
      "Folder created.",
      "Error creating folder.",
      () => fetchDriveContent(parent_id),
    );

  // Polymorphic operations (accepts file or folder item / id)

  const renameItem = (item, newName, itemType) => {
    const type = getItemType(item, itemType);
    if (!type) {
      toast.error("Item type is required.");
      return Promise.resolve(false);
    }
    const isFolder = isFolderItem(item, type);
    const endpoint = isFolder ? "folders" : "files";
    const id = typeof item === "object" ? item.id : item;
    return runAction(
      api.patch(`/api/${endpoint}/${id}/rename`, { name: newName }),
      `${isFolder ? "Folder" : "File"} renamed.`,
      "Error renaming item.",
      () => fetchDriveContent(),
    );
  };

  const moveItem = (item, targetFolderId, itemType) => {
    const type = getItemType(item, itemType);
    if (!type) {
      toast.error("Item type is required.");
      return Promise.resolve(false);
    }
    const isFolder = isFolderItem(item, type);
    const endpoint = isFolder ? "folders" : "files";
    const payload = isFolder
      ? { target_parent: targetFolderId }
      : { target_folder: targetFolderId };
    const id = typeof item === "object" ? item.id : item;
    return runAction(
      api.patch(`/api/${endpoint}/${id}/move`, payload),
      `${isFolder ? "Folder" : "File"} moved.`,
      "Error moving item.",
      () => fetchDriveContent(),
    );
  };

  const deleteItem = (item, itemType) => {
    const type = getItemType(item, itemType);
    if (!type) {
      toast.error("Item type is required.");
      return Promise.resolve(false);
    }
    const isFolder = isFolderItem(item, type);
    const endpoint = isFolder ? "folders" : "files";
    const id = typeof item === "object" ? item.id : item;
    return runAction(
      api.delete(`/api/${endpoint}/${id}`),
      `${isFolder ? "Folder" : "File"} moved to Trash.`,
      "Error deleting item.",
      () => fetchDriveContent(),
    );
  };

  const restoreItem = (item, itemType) => {
    const type = getItemType(item, itemType);
    if (!type) {
      toast.error("Item type is required.");
      return Promise.resolve(false);
    }
    const endpoint = isFolderItem(item, type) ? "folders" : "files";
    const id = typeof item === "object" ? item.id : item;
    return runAction(
      api.post(`/api/${endpoint}/${id}/restore`),
      "Item restored.",
      "Error restoring item.",
    );
  };

  const permanentDeleteItem = (item, itemType) => {
    const type = getItemType(item, itemType);
    if (!type) {
      toast.error("Item type is required.");
      return Promise.resolve(false);
    }
    const endpoint = isFolderItem(item, type) ? "folders" : "files";
    const id = typeof item === "object" ? item.id : item;
    return runAction(
      api.delete(`/api/${endpoint}/${id}/permanent`),
      "Item permanently deleted.",
      "Error deleting item.",
      () => refreshUser(),
    );
  };

  return {
    uploadFiles,
    createFolder,
    renameItem,
    moveItem,
    deleteItem,
    restoreItem,
    permanentDeleteItem,
    isUploading,
    uploadProgress,
  };
}
