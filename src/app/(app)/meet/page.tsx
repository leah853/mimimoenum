"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { HiOutlineVideoCamera } from "react-icons/hi";

const MEETING_ID = "81652804327";
const MEETING_PWD = "aCjH5WFtpqENykVv5bmVIswQPiX4sn.1";

export default function MeetPage() {
  const { dbUser, loading } = useAuth();
  const [launched, setLaunched] = useState(false);
  const name = dbUser?.full_name || "Guest";

  // Zoom web client supports &uname for pre-filling name
  const zoomWebUrl = `https://us05web.zoom.us/wc/join/${MEETING_ID}?pwd=${MEETING_PWD}&uname=${encodeURIComponent(name)}`;
  // Fallback — standard Zoom link (opens app)
  const zoomAppUrl = `https://us05web.zoom.us/j/${MEETING_ID}?pwd=${MEETING_PWD}`;

  useEffect(() => {
    if (!loading && dbUser && !launched) {
      setLaunched(true);
      // Small delay then open
      setTimeout(() => {
        window.open(zoomWebUrl, "_blank");
      }, 1000);
    }
  }, [loading, dbUser, launched, zoomWebUrl]);

  if (loading) return <div className="p-8 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" /></div>;

  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto shadow-lg">
          <HiOutlineVideoCamera className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Joining as</h1>
          <p className="text-3xl font-bold gradient-text mt-2">{name}</p>
          <p className="text-sm text-gray-500 mt-2">Your name is set from your login and cannot be changed.</p>
        </div>
        <div className="space-y-3">
          {/* Primary — web client with name pre-filled */}
          <a href={zoomWebUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:brightness-110 text-white font-medium rounded-xl shadow-lg transition-all active:scale-[0.97]">
            <HiOutlineVideoCamera className="w-5 h-5" /> Join as {name}
          </a>
          {/* Fallback — opens Zoom app */}
          <div>
            <a href={zoomAppUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors underline">
              Open in Zoom app instead
            </a>
          </div>
          <p className="text-xs text-gray-400">Meeting should open automatically in your browser.</p>
        </div>
      </div>
    </div>
  );
}
