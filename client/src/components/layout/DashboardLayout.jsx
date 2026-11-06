import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useApp } from "../../context/AppContext";
import api from "../../config/api";
import toast from "react-hot-toast";

const DashboardLayout = () => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);

  const [folderName, setFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const { currentFolderId, setFolders } = useApp();

  const closeCreateFolder = () => {
    if (isCreatingFolder) return;
    setIsCreateFolderOpen(false);
    setFolderName("");
  };

  const handleCreateFolder = async (event) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      const { data } = await api.post("/api/folders", {
        name,
        parent_id: currentFolderId,
      });
      setFolders((folders) => [...folders, data.folder]);
      toast.success("Folder created successfully");
      setIsCreateFolderOpen(false);
      setFolderName("");
    } catch (error) {
      toast.error(error.response?.data?.error || "Error creating folder");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Sidebar */}
      <Sidebar
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
        onCreateFolderClick={() => setIsCreateFolderOpen(true)}
      />

      <Modal
        isOpen={isCreateFolderOpen}
        onClose={closeCreateFolder}
        title="New Folder"
      >
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <label htmlFor="folder-name" className="block text-sm font-medium">
            Folder name
          </label>
          <input
            id="folder-name"
            autoFocus
            required
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            disabled={isCreatingFolder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCreateFolder} disabled={isCreatingFolder}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isCreatingFolder} disabled={!folderName.trim()}>
              Create Folder
            </Button>
          </div>
        </form>
      </Modal>

      {/* Main Content Workspace */}
      <div className="md:pl-64 flex flex-col flex-1">
        {/* header */}
        <Header onMobileMenuToggle={() => setIsMobileOpen(!isMobileOpen)} />

        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
