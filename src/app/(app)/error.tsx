"use client";
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-red-200/60 dark:border-red-800/40 rounded-2xl p-8 max-w-md text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
          <span className="text-2xl">&#x26A0;&#xFE0F;</span>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Something went wrong</h2>
        <p className="text-sm text-gray-500">{error.message || "An unexpected error occurred"}</p>
        <button onClick={reset} className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl hover:brightness-110 transition-all">
          Try again
        </button>
      </div>
    </div>
  );
}
