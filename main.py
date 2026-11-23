import os

import joblib
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from sqlalchemy import create_engine

load_dotenv()
engine = create_engine(os.getenv("DATABASE_URL"), pool_pre_ping=True)
model = joblib.load("model.joblib")
THRESHOLD = 1.672

app = FastAPI(title="Energy Forecaster API")


def load_usage():
    data = pd.read_sql(
        "SELECT timestamp, usage_kw FROM readings ORDER BY timestamp",
        engine,
        index_col="timestamp",
    )
    return data["usage_kw"]


def make_features(usage):
    features = pd.DataFrame(index=usage.index)
    features["lag_1"] = usage.shift(1)
    features["lag_24"] = usage.shift(24)
    features["lag_168"] = usage.shift(168)
    features["roll_mean_6"] = usage.shift(1).rolling(6).mean()
    features["roll_mean_24"] = usage.shift(1).rolling(24).mean()
    features["hour"] = usage.index.hour
    features["dayofweek"] = usage.index.dayofweek
    features["month"] = usage.index.month
    features["is_weekend"] = (usage.index.dayofweek >= 5).astype(int)
    return features


@app.get("/")
def home():
    return {"message": "Energy Forecaster API is running"}


@app.get("/anomalies")
def anomalies(days: int = 30):
    usage = load_usage()
    features = make_features(usage).dropna()

    result = pd.DataFrame(index=features.index)
    result["actual_kw"] = usage.loc[features.index]
    result["predicted_kw"] = model.predict(features)
    result["error_kw"] = result["actual_kw"] - result["predicted_kw"]

    result = result[result["error_kw"].abs() > THRESHOLD]

    start = usage.index.max() - pd.Timedelta(days=days)
    result = result[result.index > start]

    result["type"] = np.where(result["error_kw"] > 0, "spike", "drop")
    result = result.round(3).reset_index()
    result["timestamp"] = result["timestamp"].astype(str)
    return result.to_dict(orient="records")

@app.get("/forecast")
def forecast(hours: int = Query(24, ge=24, le=72)):
    history = load_usage().tail(200)
    predictions = []

    for i in range(hours):
        next_time = history.index.max() + pd.Timedelta(hours=1)
        history.loc[next_time] = np.nan

        features = make_features(history)
        next_value = model.predict(features.iloc[[-1]])[0]

        history.loc[next_time] = next_value
        predictions.append({
            "timestamp": str(next_time),
            "predicted_kw": round(float(next_value), 3),
        })

    return predictions


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    df = pd.read_csv(file.file)

    if list(df.columns) != ["timestamp", "usage_kw"]:
        raise HTTPException(status_code=400, detail="CSV must have exactly two columns: timestamp, usage_kw")

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.dropna()

    last = pd.read_sql("SELECT MAX(timestamp) FROM readings", engine).iloc[0, 0]
    new_rows = df[df["timestamp"] > last]

    new_rows.to_sql("readings", engine, if_exists="append", index=False)

    return {
        "rows_in_file": len(df),
        "rows_added": len(new_rows),
        "rows_skipped": len(df) - len(new_rows),
    }