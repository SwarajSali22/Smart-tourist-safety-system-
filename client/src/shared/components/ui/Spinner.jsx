function Spinner({ fullPage = false }) {
  if (fullPage) {
    return (
      <div className="spinner-fullpage">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  return <div className="spinner" aria-label="Loading" />;
}

export default Spinner;
