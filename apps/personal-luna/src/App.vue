<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Personal Luna</p>
        <h1>Deine persönliche KI-Begleiterin</h1>
      </div>
      <nav class="mode-switch">
        <RouterLink to="/" class="mode-link" active-class="active">Full</RouterLink>
        <RouterLink to="/chat" class="mode-link" active-class="active">Chat only</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
