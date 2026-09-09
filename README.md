# Abby's Grades

Sistema de calificaciones para clases de inglés con varios grupos. Lleva
cuatro rubros por parcial —**Attendance**, **Participation**, **Homework** y
**Exam**— y calcula las calificaciones parciales y la final.

Es una página web que funciona sin servidor: se abre `index.html` en el
navegador y los datos se guardan en el propio navegador (`localStorage`).

## Cómo usarla

1. Abre `index.html` (doble clic) en Chrome, Edge o Firefox.
2. **＋ Grupo** para crear un grupo (p. ej. "Inglés II").
3. En **Alumnos** agrega los nombres (uno por uno o pegando una lista).
4. En cada **Parcial**:
   - **Attendance**: agrega las fechas de clase ("Agregar fecha" o "Agregar
     rango de fechas" eligiendo los días de la semana). Cada celda se cambia con
     un clic: `P` presente → `A` ausente → `R` retardo → `J` justificada.
   - **Participation**: usa las mismas fechas. `P` participó → `X` no → `M` mitad.
     Al marcar una ausencia en Attendance, ese día se marca `X` automáticamente.
   - **Homework** y **Exam**: agrega tareas/exámenes con sus puntos máximos y
     captura la calificación de cada alumno. Enter baja al siguiente alumno.
   - **Resumen del parcial**: porcentajes por rubro y calificación del parcial.
5. **Calificación final**: promedio de parciales, examen final, calificación
   necesaria en el examen final para aprobar, y calificación final.
6. **Respaldar** descarga un `.json` con todo; **Restaurar** lo vuelve a cargar
   (en otra computadora, o después de limpiar el navegador). Conviene respaldar
   seguido: los datos viven en el navegador donde se capturaron.
7. **Exportar CSV** / **Imprimir** en los resúmenes.

## Cómo se calcula

Configurable por grupo en **⚙ Configurar grupo**. Valores iniciales (los del
Excel que se usaba antes):

| Concepto | Valor inicial |
| --- | --- |
| Pesos por parcial | Exam 50 %, Participation 15 %, Attendance 15 %, Homework 20 % |
| Calificación aprobatoria | 70 |
| Examen final | 50 % de la calificación final (el promedio de parciales es el otro 50 %) |
| Retardo (Tardy) | cuenta como asistencia completa (puede ser media o falta) |
| Tarea sin calificar | no cuenta (opción: cuenta como 0) |

- **Attendance** = asistencias / sesiones × 100.
- **Participation** = participaciones / sesiones × 100.
- **Homework** y **Exam** = promedio de los porcentajes de cada actividad.
- **Parcial** = suma ponderada de los cuatro rubros. Si un rubro aún no tiene
  datos, se excluye y su peso se reparte entre los demás.
- **Promedio** = promedio de los parciales con datos.
- **Final** = promedio × (100 − peso del examen final) % + examen final × peso %.
- **Necesita en final** = calificación mínima del examen final para llegar a la
  aprobatoria.

Todas las calificaciones van de 0 a 100.

## Importar el Excel anterior

`tools/import_excel.py` convierte el libro `Calificaciones_Semestre_*.xlsx`
(hojas "Ingles X", "Asistencia Ingles X" y "Tareas X") a un respaldo `.json`
que se carga con **Restaurar**:

```bash
pip install openpyxl
python3 tools/import_excel.py Calificaciones.xlsx calificaciones.json --expected esperado.json
node tools/compare_with_excel.js calificaciones.json esperado.json
```

El segundo comando compara lo que calcula la app con los valores que Excel ya
tenía calculados, para confirmar que las fórmulas coinciden.

## Desarrollo

```bash
npm test          # pruebas de la lógica de cálculo (grades.js)
npm start         # sirve la carpeta en http://localhost:8080 (opcional)
```

- `grades.js` — cálculo de calificaciones, sin dependencias de la interfaz.
- `app.js` — interfaz, almacenamiento local, respaldo, CSV.
- `styles.css`, `index.html` — presentación.
- `test/` — pruebas con `node:test`.
- `tools/` — importador del Excel y comparador.
