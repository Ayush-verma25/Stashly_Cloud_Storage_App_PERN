import React, { useRef } from "react";
import api from "../../config/api";
import toast from "react-hot-toast";
import { useApp } from "../../context/AppContext";
import { Link, useLocation } from "react-router-dom";
import {
  FolderPlusIcon,
  HardDriveIcon,
  HardDriveUploadIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { Dropdown, DropdownItem } from "../ui/Dropdown";
import { ProgressBar } from "../ui/ProgressBar";
import { formatBytes } from "../../assets/assets";

const Sidebar = ({ onCreateFolderClick, isMobileOpen, setIsMobileOpen }) => {
  const {
    user, currentFolderId, isUploading, SetIsUploading,
    SetUploadeProgress, setFiles, refreshUser,
  } = useApp();
  const location = useLocation();
  const fileInputRef = useRef(null);

  const handleFileChange = async (event) => {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || isUploading) return;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    if (currentFolderId) formData.append("folder_id", currentFolderId);

    SetIsUploading(true);
    SetUploadeProgress(0);
    try {
      const { data } = await api.post("/api/files/upload", formData, {
        onUploadProgress: ({ loaded, total }) => {
          if (total) SetUploadeProgress(Math.round((loaded / total) * 100));
        },
      });
      setFiles((existingFiles) => [...data.files, ...existingFiles]);
      await refreshUser();
      toast.success("Files uploaded successfully");
    } catch (error) {
      toast.error(error.response?.data?.error || "Error uploading files");
    } finally {
      SetIsUploading(false);
      SetUploadeProgress(0);
    }
  };

  const storage_used = Number(user?.storage_used ?? 0);
  const storage_limit = Number(user?.storage_limit ?? 1073741824); // 1GB
  const used_percentage = Math.min(
    100,
    Math.round((storage_used / storage_limit) * 100),
  );

  const navItems = [
    { label: "My Drive", path: "/", icon: HardDriveIcon },
    { label: "Shared Files", path: "/shared", icon: UserIcon },
    { label: "Trash", path: "/trash", icon: Trash2Icon },
  ];

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 md:translate-x-0 ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand header */}
        <div className="flex flex-col items-start gap-1.5 border-b border-slate-200 px-6 py-5">
          <img
            src="/stashly-logo.svg"
            alt="Stashly"
            className="block h-auto w-36 max-w-full object-contain object-left"
          />
          <p className="pl-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Cloud Storage
          </p>
        </div>

        {/* Upload CTA Dropdown */}
        <div className="p-4">
          <input type="file" ref={fileInputRef} multiple className="hidden" onChange={handleFileChange} disabled={isUploading} />

          <Dropdown
            trigger={
              <button
                type="button"
                disabled={isUploading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-lg transition-all disabled:opacity-50 cursor-pointer"
              >
                <PlusIcon className="size-5" />
                <span>New Item</span>
              </button>
            }
            align="left"
            className="w-32"
          >
            <DropdownItem
              icon={HardDriveUploadIcon}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload Files
            </DropdownItem>
            <DropdownItem icon={FolderPlusIcon} onClick={onCreateFolderClick}>
              New Folder
            </DropdownItem>
          </Dropdown>
        </div>

        {/* Navigation Link */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === "/"
                ? location.pathname === "/" ||
                  location.pathname.startsWith("/drive")
                : location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium transition-all ${isActive ? "border-r-3 border-green-500 bg-linear-to-r from-green-50 to-green-100 text-green-600" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}
              >
                <Icon
                  className={`size-4.5 ${isActive ? "text-green-600" : "text-slate-500"}`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Storage Usage Widget */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-600 font-medium">Storage</span>
            <span className="text-slate-900 font-semibold">
              {used_percentage}%
            </span>
          </div>
          <ProgressBar
            progress={used_percentage}
            color={
              used_percentage > 90
                ? "bg-red-600"
                : used_percentage > 75
                  ? "bg-amber-500"
                  : "bg-green-600"
            }
          />

          <p className="text-[11px] text-slate-500 mt-2">
            {formatBytes(storage_used)} of {formatBytes(storage_limit)} used
          </p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
