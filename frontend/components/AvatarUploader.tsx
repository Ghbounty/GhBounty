/* eslint-disable @next/next/no-img-element */
"use client";

import { useRef, useState } from "react";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB

type Props = {
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  label?: string;
  hint?: string;
  rounded?: boolean;
};

export function AvatarUploader({
  value,
  onChange,
  label = "Logo",
  hint = "PNG, JPG or SVG · up to 2MB",
  rounded = false,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File must be an image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Image must be under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onChange(result);
    };
    reader.readAsDataURL(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div
        className={`avatar-uploader ${dragging ? "dragging" : ""} ${value ? "has-image" : ""} ${rounded ? "round" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        {value ? (
          <>
            <img src={value} alt="preview" className="avatar-uploader-preview" />
            <div className="avatar-uploader-actions">
              <button
                type="button"
                className="avatar-uploader-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                Replace
              </button>
              <button
                type="button"
                className="avatar-uploader-btn ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                }}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <div className="avatar-uploader-empty">
            <div className="avatar-uploader-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
            </div>
            <div className="avatar-uploader-copy">
              <strong>Drop image here</strong>
              <span>or click to upload · {hint}</span>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
