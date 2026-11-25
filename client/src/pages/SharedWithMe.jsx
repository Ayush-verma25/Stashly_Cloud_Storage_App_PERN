import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../config/api";
import toast from "react-hot-toast";
import { Spinner } from "../components/ui/Spinner";
import { DownloadIcon, LockIcon, LucideFolder } from "lucide-react";
import { Button } from "../components/ui/Button";
import { formatBytes, getFileIcon } from "../assets/assets";

const SharedWithMe = () => {
  const { token } = useParams();
  const [navigation, setNavigation] = useState({ token: null, folderId: null });
  const [result, setResult] = useState(null);
  const currentFolderId =
    navigation.token === token ? navigation.folderId : null;

  useEffect(() => {
    let isCurrent = true;
    api
      .get(`/api/shares/access/${token}`, {
        params: currentFolderId ? { folder_id: currentFolderId } : undefined,
      })
      .then((res) => {
        if (isCurrent) {
          setResult({
            token,
            folderId: currentFolderId,
            data: res.data,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (isCurrent) {
          setResult({
            token,
            folderId: currentFolderId,
            data: null,
            error: err.response?.data?.error || "Unable to load shared item.",
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [token, currentFolderId]);

  const hasCurrentResult =
    result?.token === token && result?.folderId === currentFolderId;
  const isLoading = !hasCurrentResult;
  const error = hasCurrentResult ? result.error : null;
  const data = hasCurrentResult ? result.data : null;
  const navigateToFolder = (folderId) => setNavigation({ token, folderId });

  const downloadFile = async (fileId) => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      toast.error("Allow popups to download this file.");
      return;
    }
    tab.opener = null;
    try {
      const { data: latest } = await api.get(`/api/shares/access/${token}`, {
        params: currentFolderId ? { folder_id: currentFolderId } : undefined,
      });
      const url = latest.resource_type === "file"
        ? (latest.file?.id === fileId ? latest.url : null)
        : latest.files?.find((file) => file.id === fileId)?.url;
      if (!url) throw new Error("The shared file is no longer available.");
      tab.location.replace(url);
    } catch (err) {
      tab.close();
      toast.error(err.response?.data?.error || "Unable to download the shared file.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Minimal Header */}
      <header className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/stashly-logo.svg"
            alt="Stashly"
            className="block h-auto w-36 max-w-full object-contain object-left"
          />
        </Link>

        <Link
          to="/login"
          className="text-xs font-semibold text-green-600 hover:underline"
        >
          Sign In
        </Link>
      </header>

      {/* Content Container */}
      <main className="flex-1 flex items-center justify-center p-6">
        {isLoading ? (
          <div className="text-center space-y-3">
            <Spinner size="lg" className="text-green-600" />
            <p className="text-sm text-slate-500 font-medium">
              Loading Shared item...
            </p>
          </div>
        ) : error ? (
          <div className="max-w-md w-full p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-4">
            <div className="size-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
              <LockIcon className="size-6" />
            </div>
            <h3>{currentFolderId ? "Folder Unavailable" : "Link Unavailable"}</h3>
            <p>{error}</p>
            <div className="pt-2">
              {currentFolderId ? (
                <Button variant="secondary" size="sm" onClick={() => navigateToFolder(null)}>
                  Back to Shared Folder
                </Button>
              ) : (
                <Link to="/">
                  <Button variant="secondary" size="sm">
                    Go to Homepage
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : data?.resource_type === "file" ? (
          <div className="max-w-xl w-full p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-6 animate-fade-in">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto">
              {getFileIcon(data.file.mime_type, "size-10")}
            </div>

            <div>
              <h2 className="text-xl font-medium text-slate-900 mb-1">
                {data.file.name}
              </h2>
              <p className="text-xs text-slate-500">
                Size: {formatBytes(data.file.size)} ● Shared by{" "}
                {data.owner?.name || "User"}
              </p>
            </div>

            {data.permission === "download" ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 font-medium">
                This link grants{" "}
                <span className="text-green-600 font-semibold">
                  download-only
                </span>{" "}
                permission.
              </div>
            ) : null}

            {data.url && (
              <button
                type="button"
                onClick={() => downloadFile(data.file.id)}
                className="inline-flex items-center justify-center gap-2 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-lg transition"
              >
                <DownloadIcon className="size-4" />
                <span>Download File</span>
              </button>
            )}
          </div>
        ) : (
          <div className="max-w-2xl w-full p-8 bg-white border border-slate-200 rounded-3xl space-y-6">
            <div className=" flex items-center gap-3">
              <div className="p-2 rounded-xl bg-green-50 text-green-600 border border-green-100">
                <LucideFolder className="size-6 fill-green-500/20" />
              </div>

              <div>
                <h2>{data.folder.name}</h2>
                <p className="text-xs text-slate-500">
                  Shared Folder by {data.owner?.name || "User"}
                </p>
              </div>
            </div>

            <nav aria-label="Shared folder location" className="flex flex-wrap items-center gap-2 text-sm">
              {data.breadcrumbs?.map((folder, index) => (
                <React.Fragment key={folder.id}>
                  {index > 0 && <span className="text-slate-400">/</span>}
                  <button
                    type="button"
                    onClick={() =>
                      navigateToFolder(
                        folder.id === data.root_folder_id ? null : folder.id,
                      )
                    }
                    className={`rounded px-1 py-0.5 ${
                      index === data.breadcrumbs.length - 1
                        ? "font-semibold text-slate-900"
                        : "text-green-700 hover:bg-green-50"
                    }`}
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Contents
              </h2>

              {data.subfolder?.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => navigateToFolder(folder.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-green-300 hover:bg-green-50/40"
                >
                  <LucideFolder className="size-5 shrink-0 text-green-600" />
                  <span className="truncate text-sm font-medium text-slate-800">
                    {folder.name}
                  </span>
                </button>
              ))}

              {(!data.files || data.files.length === 0) &&
              (!data.subfolder || data.subfolder.length === 0) ? (
                <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 font-medium">
                  This folder is empty.
                </div>
              ) : data.files?.length > 0 ? (
                <div className="divide-y divide-slate-200 bg-slate-50/50 border border-slate-200 rounded-xl overflow-hidden">
                  {data.files.map((f) => (
                    <div
                      key={f.id}
                      className="p-3.5 flex items-center justify-between hover:bg-slate-100/80 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-3">
                        {getFileIcon(f.mime_type, "size-5 shrink-0")}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {f.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatBytes(f.size)}
                          </p>
                        </div>
                      </div>

                      {f.url && (
                        <button
                          type="button"
                          onClick={() => downloadFile(f.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition shrink-0"
                        >
                          <DownloadIcon className="h-3.5" />
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SharedWithMe;
