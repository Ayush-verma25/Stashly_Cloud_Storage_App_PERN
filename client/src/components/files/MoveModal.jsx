import React, { useEffect, useState } from "react";
import { useDrive } from "../../hooks/useDrive";
import { Modal } from "../ui/Modal";
import { FolderIcon, HardDriveIcon } from "lucide-react";
import { Button } from "../ui/Button";
import api from "../../config/api";

const MoveModal = ({ item, isOpen, onClose }) => {
  const [availableFolder, setAvailableFolder] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const { moveItem } = useDrive();

  useEffect(() => {
    if (!isOpen) return;

    setSelectedFolderId(item?.parent_id ?? null);

    Promise.all([api.get("/api/folders"), api.get("/api/trash")])
      .then(([response, trashResponse]) => {
        const folders = response?.data?.folders || [];
        const allFolders = [...folders, ...(trashResponse.data?.folders || [])];
        const parents = new Map(allFolders.map((folder) => [folder.id, folder.parent_id]));
        const isDescendant = (folder) => {
          const visited = new Set();
          let id = folder.id;
          while (id != null && !visited.has(id)) {
            if (id === item.id) return true;
            visited.add(id);
            id = parents.get(id);
          }
          return false;
        };
        const filtered = folders.filter(
          (folder) => item?.item_type !== "folder" || !isDescendant(folder),
        );
        setAvailableFolder(filtered);
      })
      .catch(() => setAvailableFolder([]));
  }, [item, isOpen]);

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

          {availableFolder.map((folder) => (
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
