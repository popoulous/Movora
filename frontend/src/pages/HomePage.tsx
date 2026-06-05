export function HomePage(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Welcome to Movora</h1>
      <p className="mt-3 text-neutral-400">
        Pick a library from the sidebar, or add one with the <span className="text-neutral-200">+</span>{" "}
        button to browse your folders.
      </p>
    </div>
  );
}
