function createOverlaySocket() {
  const user = new URLSearchParams(window.location.search).get('user') || '';
  return io({ query: { user } });
}

function getOverlayBgId() {
  const bg = new URLSearchParams(window.location.search).get('bg');
  return bg === 'transparent' ? 'transparent' : 'dim';
}