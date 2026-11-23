import {
  FolderIcon,
  RotateCcwIcon,
  Trash2Icon,
  TrashIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDrive } from "../hooks/useDrive";
import { useApp } from "../context/AppContext";
import api from "../config/api";
import toast from "react-hot-toast";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { formatBytes, getFileIcon } from "../assets/assets";

const Trash = () => {
  const [trash, setTrash] = useState({ files: [], folders: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isEmptying, setIsEmptying] = useState(false);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const trashRequestId = useRef(0);

  const { files, folders } = trash;
  const { restoreItem, permanentDeleteItem } = useDrive();
  const { refreshUser } = useApp();

  const fetchTrash = useCallback(async () => {
    const requestId = ++trashRequestId.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get("/api/trash");
      if (requestId !== trashRequestId.current) return;
      setTrash({ files: data.files || [], folders: data.folders || [] });
      setLoadError(null);
    } catch (error) {
      if (requestId === trashRequestId.current) {
        const message = error.response?.data?.error || "Error loading trash";
        setLoadError(message);
        toast.error(message);
      }
    } finally {
      if (requestId === trashRequestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (item, isFolder) => {
    const restored = await restoreItem({
      ...item,
      item_type: isFolder ? "folder" : "file",
    });
    if (restored) await fetchTrash();
  };

  const handlePermanentDelete = async () => {
    if (!itemToDelete) return;
    setIsDeletingItem(true);
    try {
      const deleted = await permanentDeleteItem({
        ...itemToDelete.item,
        item_type: itemToDelete.isFolder ? "folder" : "file",
      });
      if (deleted) {
        setItemToDelete(null);
        await fetchTrash();
      }
    } finally {
      setIsDeletingItem(false);
    }
  };

  const handleEmptyTrash = async () => {
    setIsEmptying(true);
    try {
      await api.delete("/api/trash/empty");
      toast.success("Trash emptied successfully.");
      setShowEmptyConfirm(false);
      await Promise.all([fetchTrash(), refreshUser()]);
    } catch (error) {
      toast.error(error.response?.data?.error || "Error emptying trash");
    } finally {
      setIsEmptying(false);
    }
  };

  const hasItems = files.length > 0 || folders.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
            <Trash2Icon className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-slate-900">Trash</h2>
            <p className="text-xs text-slate-500">
              Items in trash are soft deleted
            </p>
          </div>
        </div>
        {hasItems && (
          <Button
            variant="danger"
            size="sm"
            icon={TrashIcon}
            onClick={() => setShowEmptyConfirm(true)}
          >
            Empty Trash
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Spinner size="lg" className="text-green-600" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-white p-6 text-center">
          <p className="mb-4 text-sm text-red-600">{loadError}</p>
          <Button variant="secondary" onClick={fetchTrash}>
            Retry
          </Button>
        </div>
      ) : !hasItems ? (
        <EmptyState
          title="Trash is Empty"
          description="Items you delete will show up here before being permanently removed."
          icon={Trash2Icon}
        />
      ) : (
        <div className="space-y-6">
          {[
            { title: "Folders", items: folders, isFolder: true },
            { title: "Files", items: files, isFolder: false },
          ].filter(({ items }) => items.length > 0)
            .map(({ title, items, isFolder }) => {
              return (
                <section key={title}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {title}
                  </h3>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                            {isFolder ? (
                              <FolderIcon className="size-5 text-green-600" />
                            ) : (
                              getFileIcon(item.mime_type, "size-5")
                            )}
                          </div>
                          <div className="min-w-0">
                            <p
                              className="truncate text-sm font-medium text-slate-800"
                              title={item.name}
                            >
                              {item.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {isFolder ? "Folder" : formatBytes(item.size)}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={RotateCcwIcon}
                            onClick={() => handleRestore(item, isFolder)}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            icon={TrashIcon}
                            onClick={() => setItemToDelete({ item, isFolder })}
                          >
                            Delete permanently
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      )}
      <ConfirmDialog
        isOpen={showEmptyConfirm}
        onClose={() => setShowEmptyConfirm(false)}
        onConfirm={handleEmptyTrash}
        title="Empty Trash"
        message="Permanently delete all items in Trash? This action cannot be undone."
        confirmText="Empty Trash"
        isLoading={isEmptying}
      />
      <ConfirmDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handlePermanentDelete}
        title="Delete permanently"
        message={`Permanently delete "${itemToDelete?.item.name}"? This action cannot be undone.`}
        confirmText="Delete permanently"
        isLoading={isDeletingItem}
      />
    </div>
  );
};

export default Trash;
