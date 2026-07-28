export function Button({ children, onClick }) {
  return (
    <button
      className="px-4 py-2 rounded-md bg-[#3b6ea5] text-white"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
