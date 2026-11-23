export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[380px] animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 grid size-14 place-items-center rounded-[16px] bg-text text-bg shadow-raised" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-7" fill="none">
              <path d="M4 15.5V12l2-4.5h12l2 4.5v3.5M4 15.5h16M4 15.5V18m16-2.5V18M7.5 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="display text-[28px] font-semibold">Flota</h1>
          <p className="mt-1 text-[15px] text-text-2">Gestión económica de licencias de taxi</p>
        </div>
        {children}
        <p className="mt-8 text-center text-[12px] text-text-3">Acceso restringido. Los accesos quedan registrados.</p>
      </div>
    </div>
  );
}
