# Smart Energy Load Forecaster and Anomaly Detector

Predicts a household's electricity usage for the next 24–72 hours and flags unusual readings.
Week 1 of the Two-Week AI Project.

**Stack:** Python · pandas · LightGBM · scikit-learn · PostgreSQL (Neon) · FastAPI · React (Vite) · Recharts · Docker

---

## How it works

```
React website  ──►  FastAPI backend  ──►  LightGBM model (model.joblib)
(localhost:5173)    (localhost:8000)  ──►  PostgreSQL database (Neon)
```

| Folder / file | What it is |
|---|---|
| `01_explore.ipynb` | Data exploration, cleaning, baseline, model training, anomaly detection (Steps 1–5) |
| `main.py` | FastAPI backend (Step 6) |
| `model.joblib` | Trained LightGBM model |
| `Dockerfile`, `requirements.txt` | Container setup for deployment (Step 7) |
| `frontend/` | React website (Step 8) |

---

## 1. Data and cleaning

**Dataset:** UCI Household Electric Power Consumption: one house, one reading per minute,
16 Dec 2006 – 26 Nov 2010 (**2,075,259 rows**). Target column: `Global_active_power` (kW).

- The file uses `;` as separator, `?` for missing values and day/month/year dates, so these were set explicitly when loading.
- **25,979 readings (1.25%) were missing**, mostly as whole days (e.g. 18–21 Aug 2010), probably when the meter was off.
- Minute readings were **averaged to hourly** (34,589 hours). This leaves less noise and is detailed enough to forecast 1–3 days ahead.
- After averaging, 421 hours were still missing:
  - gaps of **≤ 3 hours** → filled by straight-line interpolation
  - **longer gaps** → filled with the **same hour from the previous week**, which keeps a realistic daily and weekly shape
  - Rows were **not deleted**, because holes in the timeline would break the "24 h ago" and "7 days ago" features.
- Result: **0 missing hours**. The data was stored in PostgreSQL (table `readings(timestamp PRIMARY KEY, usage_kw)`).

**Patterns found:** usage peaks at **20:00**, is highest on **Saturdays** and in **December** (heating, long evenings).

---

## 2. Model choice

**Model:** LightGBM regressor (500 trees, learning rate 0.03): supervised regression.

**Features (all built from the past, so no future data leaks in):**

| Type | Features |
|---|---|
| Lag | usage 1 h, 24 h and 168 h (7 days) ago |
| Rolling | mean of the last 6 h and 24 h |
| Calendar | hour, day of week, month, weekend flag |

**Why LightGBM:**
- Works very well on **tabular data** like this, and learns interactions such as "hour 20 on a Saturday in winter" without manual rules.
- Fast to train, needs no feature scaling, and handles both lag and calendar features.
- Gives **feature importance**, so the model can be explained. The top features were `lag_1`, `hour` and `lag_168`.

**Train/test split:** by time, not randomly. The last **4 weeks (672 hours)** are the test set and the earlier **33,749 hours** are used for training. A random split would let the model "see the future".

---

## 3. Results: MAE and MAPE against the baseline

Test period: last 4 weeks (672 hours).

| Method | MAE (kW) | MAPE |
|---|---|---|
| Baseline: same hour yesterday | 0.617 | 73.2% |
| Baseline: same as 1 hour ago | 0.464 | – |
| **LightGBM** | **0.368** | **40.9%** |

LightGBM is **21% better** than the best baseline and **40% better** than the same-hour-yesterday baseline.

MAPE is high for every method because night-time usage is very small (about 0.3 kW), so small errors turn into large percentages. **MAE is the more reliable metric here.**

---

## 4. Anomaly detection

Two methods were compared, each flagging the most unusual 1% of hours (345 hours):

| | Isolation Forest | Forecast-error method |
|---|---|---|
| Idea | Flags readings that are rare overall (usage, hour, day) | Flags hours where \|actual − predicted\| > **1.672 kW** |
| Finds high spikes | Only the very large ones | Yes, including daytime spikes |
| Finds unexpected drops | No | Yes |
| False alarms | Many at midnight / Sunday–Monday (edge effect) | Fewer |

Both methods agreed on 128 hours. After checking flagged days by hand, the **forecast-error method worked better**: it judges each reading against what is normal *for that exact hour and recent history*. It is used in the API.

---

## 5. API (FastAPI)

| Endpoint | What it does |
|---|---|
| `GET /history?hours=168` | Past hourly usage from the database |
| `GET /forecast?hours=24` | Forecast for the next 24–72 hours (recursive: each prediction is fed back as the next hour's input) |
| `GET /anomalies?days=30` | Unusual readings in the last N days, labelled `spike` or `drop` |
| `POST /upload` | Upload a CSV (`timestamp,usage_kw`, hourly); only rows newer than the latest reading are added |

Interactive docs are at `/docs`.

## 6. Website (React + Recharts)

- **Upload button** → sends a CSV to `/upload` and refreshes the page
- **Chart** → last 7 days of usage (solid) + next 48 hours of forecast (dashed)
- **Table** → unusual readings from the last 30 days, with spikes and drops coloured

---

## How to run locally

**Backend**
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
# create a .env file with: DATABASE_URL=postgresql://...
python -m uvicorn main:app --reload
```

**Website** (in a second terminal)
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

---

## Deployment status

- The **Dockerfile is written** but not yet built or deployed:
  - Cloud Run, Hugging Face Spaces and Render required a payment card or a paid plan.
  - Docker Desktop needs administrator rights to enable WSL.
- The project runs locally; see the demo recording.
- The image can be deployed later without code changes (e.g. `gcloud run deploy --source .`). The database stays on Neon instead of Cloud SQL, which has no free tier.

---

## What doesn't work well yet

- **Accuracy figures are 1-hour-ahead.** The 24–72 h forecast is recursive, so errors build up and accuracy further ahead is lower. It was not measured separately.
- **The forecast is smooth.** It follows the daily pattern but cannot predict sudden spikes (an oven or heater switching on).
- **High MAPE (40.9%)** because night-time values are very small.
- **The anomaly threshold (1.672 kW)** was chosen on data the model was trained on, so errors there are slightly smaller than on new data.
- **The forecast-error method can miss the later hours of a long spike**, because `lag_1` makes the model "get used to" the high level.
- **`/upload`** only accepts hourly data in one exact format, has no login, and the model is not retrained on uploaded data.
- **Not deployed**, so there's no live link yet (see Deployment status).