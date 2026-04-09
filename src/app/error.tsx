"use client";
export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-red-200/60 dark:border-red-800/40 rounded-2xl p-10 max-w-lg text-center space-y-5 shadow-xl">
        <div className="w-14 h-14 mx-auto rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
          <span className="text-3xl">&#x26A0;&#xFE0F;</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Something went wrong</h2>
        <p className="text-sm text-gray-500">{error.message || "An unexpected error occurred"}</p>
        <button onClick={reset} className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-medium rounded-xl hover:brightness-110 transition-all shadow-md">
          Try again
        </button>
      </div>
    </div>
  );
}
