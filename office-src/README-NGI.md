# Virtual Office NGI (berbasis Claude Office, MIT © W17ANT)

Sumber tampilan pixel-art Virtual Office di Command Center. Diadaptasi dari
https://github.com/W17ant/Claude-Office :
- data dari `/api/office/state` (src/hooks/useNgiFeed.ts), bukan WebSocket lokal
- tema "Dunder Mifflin" dan sprite tokoh serial TV dihapus
- aset dikompres (rooms → webp, sprite dipalet ulang)

Build ulang:
    cd office-src && npm install && npm run build
    # salin dist/* ke ../office/ (pertahankan office/3d.html & LICENSE-claude-office.txt)
