"use client";

import { useState } from "react";
import { API_URL } from "@/config/api";
import PageHeader from "@/features/shared/components/PageHeader";

export default function UploadPage() {

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleUpload = async () => {
    setError(null);
    setSuccess(null);

    // Validate file is selected
    if (!file) {
      setError("Please select a file first");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || errorData.message || "Upload failed");
      }

      const payload = await res.json();
      const data = payload?.success === true && Object.prototype.hasOwnProperty.call(payload, "data")
        ? payload.data
        : payload;
      setSuccess("Upload successful! URL: " + data.url);
      console.log(data);

    } catch (err) {
      setError(err.message || "Failed to upload file");
      console.error("Upload error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <PageHeader />

      <div style={{ maxWidth: 600, margin: "40px auto", padding: "0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24, color: "#0F1923" }}>Upload Trade Screenshot</h1>

      <input
        type="file"
        onChange={(e) => setFile(e.target.files[0])}
        className="mb-4"
      />

      <button
        onClick={handleUpload}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 ml-4 disabled:bg-gray-400"
      >
        {loading ? "Uploading..." : "Upload"}
      </button>

      {error && (
        <p className="text-red-500 mt-4">Error: {error}</p>
      )}

      {success && (
        <p className="text-green-500 mt-4">{success}</p>
      )}

      </div>
    </div>
  );
}
