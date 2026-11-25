import React, { useEffect, useState } from "react";
import { useDrive } from "../../hooks/useDrive";
import { Modal } from "../ui/Modal";
import { FolderIcon, HardDriveIcon } from "lucide-react";
import { Button } from "../ui/Button";
import api from "../../config/api";
import toast from "react-hot-toast";

const MoveModal = ({ item, isOpen, onClose }) => {
  const [availableFolder, setAvailableFolder] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const { moveItem } = useDrive();
  const itemId = item?.id;
  const itemType = item?.item_type;
  const parentId = item?.parent_id ?? item?.folder_id ?? null;

  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || itemId == null) {
      return () => {
        isCancelled = true;
      };
    }

    setSelectedFolderId(parentId);
    setIsLoadingFolders(true);

    api.get("/api/folders", { params: { all: true } })
      .then(({ data }) => {
        const folders = data?.folders || [];
        const filtered = folders.filter((folder) =>
          itemType !== "folder" ||
          (folder.id !== itemId && !folder.path?.includes(itemId)),
        );
        if (!isCancelled) setAvailableFolder(filtered);
      })
      .catch((error) => {
        if (!isCancelled) {
          setAvailableFolder([]);
          toast.error(error.response?.data?.error || "Could not load folders.");
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingFolders(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [itemId, itemType, parentId, isOpen]);

  const handleMove = async () => {
    if (!item || isMoving) return;

    setIsMoving(true);
    let ok;
    try {
      ok = await moveItem(item, selectedFolderId);
    } finally {
      setIsMoving(false);
    }
    if (ok) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Move "${item?.name || "item"}"`}>
      <div className="space-y-4">
        <p className="text-xs font-medium text-slate-500">
          Select destination folder:
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-xl max-h-60 overflow-y-auto divide-y divide-slate-200 p-1">
          <button
            onClick={() => setSelectedFolderId(null)}
            type="button"
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
              selectedFolderId === null
                ? "bg-green-50 text-green-700 border border-green-200 font-semibold"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <HardDriveIcon className="size-4 text-green-600" />
            <span>My Drive (Root)</span>
          </button>

          {isLoadingFolders ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">Loading folders...</p>
          ) : availableFolder.map((folder) => (
            <button
              key={folder.id}
              onClick={() => setSelectedFolderId(folder.id)}
              type="button"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                selectedFolderId === folder.id
                  ? "bg-green-50 text-green-700 border border-green-200 font-semibold"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <FolderIcon className="size-4 text-green-600 fill-green-500/20" />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" isLoading={isMoving} onClick={handleMove}>
            Move Here
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default MoveModal;
