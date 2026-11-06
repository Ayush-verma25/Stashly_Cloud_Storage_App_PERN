import { LucideFolder } from "lucide-react";
import React from "react";
import { ItemDropdown } from "../ui/ItemDropdown";

const FolderCard = ({
  folder,
  onClick,
  onShare,
  onRename,
  onMove,
  onDelete,
}) => {
  return (
    <div
      onClick={() => onClick(folder)}
      className="group relative bg-white border border-slate-200 hover:border-green-200 rounded-2xl p-4 transition-all duration-200 cursor-pointer flex items-center justify-between"
    >
      <div className="flex items-center gap-3 min-w-0 pr-2">
        <div className="p-2.5 rounded-xl bg-green-50 text-green-600 shrink-0 border border-green-100">
          <LucideFolder className="size-6 fill-green-500/20" />
        </div>
        <h4
          className="text-sm font-medium text-slate-800 truncate group-hover:text-green-600 transition-colors"
          title={folder.name}
        >
          {folder.name}
        </h4>
      </div>

      <ItemDropdown
        item={folder}
        onShare={onShare}
        onRename={onRename}
        onMove={onMove}
        onDelete={onDelete}
      />
    </div>
  );
};

export default FolderCard;
