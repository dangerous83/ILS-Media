import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="login">
      <div className="login__globe" aria-hidden />
      <div className="login__glow" aria-hidden />

      <section className="login__card">
        <img src="/ils-icon-white.png" alt="ILS" className="login__icon" width={96} height={96} />
        <p className="eyebrow">ILS · Media Vault</p>
        <h1 className="login__title">
          Secure video <em>storage</em>
        </h1>
        <p className="login__lede">Enter the access password to open the ILS media library.</p>
        <LoginForm />
      </section>

      <footer className="login__footer">
        © {new Date().getFullYear()} ILS · Authorized personnel only
      </footer>
    </main>
  );
}
