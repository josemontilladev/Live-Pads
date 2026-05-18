const fs = require('fs');
const path = require('path');
const MP3Cutter = require('mp3-cutter');

const TARGET_DIRECTORIES = [
  path.join(__dirname, 'src/assets/Pads Amb/Organic Pad'),
  path.join(__dirname, 'src/assets/Pads Amb/Fundations Pad')
];

// Target duration in seconds: 3 minutes (180s)
const TARGET_DURATION_SEC = 180;

async function compressPads() {
  console.log("=== INICIANDO COMPRESIÓN DE PADS DE AMBIENTE ===");
  
  for (const dir of TARGET_DIRECTORIES) {
    if (!fs.existsSync(dir)) {
      console.warn(`Directorio no encontrado: ${dir}`);
      continue;
    }
    
    console.log(`\nProcesando directorio: ${path.basename(dir)}`);
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp3'));
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      // Only process files that are large (e.g. > 5 MB)
      if (stats.size > 5 * 1024 * 1024) {
        console.log(`  - Recortando: "${file}" (${sizeMB} MB)`);
        const tempPath = path.join(dir, 'temp_' + file);
        
        try {
          MP3Cutter.cut({
            src: filePath,
            target: tempPath,
            start: 0,
            end: TARGET_DURATION_SEC
          });
          
          // Verify new file exists and is smaller
          if (fs.existsSync(tempPath)) {
            const tempStats = fs.statSync(tempPath);
            const newSizeMB = (tempStats.size / (1024 * 1024)).toFixed(2);
            
            // Overwrite original safely
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            console.log(`    ✔️ Éxito: Reducido a ${newSizeMB} MB`);
          } else {
            console.error(`    ❌ Error: No se pudo generar archivo temporal para ${file}`);
          }
        } catch (e) {
          console.error(`    ❌ Error recortando "${file}":`, e.message);
          if (fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
          }
        }
      } else {
        console.log(`  - Omitiendo (ya optimizado): "${file}" (${sizeMB} MB)`);
      }
    }
  }
  
  console.log("\n=== COMPRESIÓN DE PADS FINALIZADA CON ÉXITO ===");
}

compressPads();
