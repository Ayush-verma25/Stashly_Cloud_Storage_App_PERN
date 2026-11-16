import React, { useState } from "react";
import { useDrive } from "../../hooks/useDrive";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

const CreateFolderModal = ({ isOpen, onClose }) => {
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { createFolder } = useDrive();

  const handleClose = () => {
    if (isLoading) return;
    setName("");
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const folderName = name.trim();
    if (!folderName || isLoading) return;

    setIsLoading(true);
    try {
      const created = await createFolder(folderName);
      if (created) {
        setName("");
        onClose();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Folder">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="Folder Name"
          placeholder="Untitled Folder"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={handleClose}
            type="button"
            disabled={isLoading}
          >
            Cancel
          </Button>

          <Button
            variant="primary"
            type="submit"
            disabled={!name.trim()}
            isLoading={isLoading}
          >
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateFolderModal;
