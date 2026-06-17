function createOverlaySocket() {
  const user = new URLSearchParams(window.location.search).get('user') || '';
  return io({ query: { user } });
}