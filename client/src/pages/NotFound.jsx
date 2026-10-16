import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

function NotFound() {
  return (
    <main className="page not-found">
      <Compass size={40} aria-hidden="true" />
      <h1>Page not found</h1>
      <p className="placeholder-text">That address doesn’t exist, or you may not have access to it.</p>
      <Link className="btn btn--primary" to="/">Back home</Link>
    </main>
  );
}

export default NotFound;
