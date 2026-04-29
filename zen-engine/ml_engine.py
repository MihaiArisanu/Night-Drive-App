import numpy as np
from sklearn.cluster import DBSCAN
from typing import List, Tuple

from models import HistoryRecord

def get_zen_clusters(history_records: List[HistoryRecord]) -> List[Tuple[float, float]]:
    if not history_records:
        return []

    coords = np.array([[r.latitude, r.longitude] for r in history_records])
    coords_rad = np.radians(coords)
    
    kms_per_radian = 6371.0088
    epsilon = 0.5 / kms_per_radian
    
    db = DBSCAN(eps=epsilon, min_samples=5, algorithm='ball_tree', metric='haversine').fit(coords_rad)
    labels = db.labels_
    
    cluster_centroids = []
    for label in set(labels):
        if label == -1:
            continue
        
        class_member_mask = (labels == label)
        cluster_coords = coords[class_member_mask]
        centroid = cluster_coords.mean(axis=0)
        cluster_centroids.append((float(centroid[0]), float(centroid[1])))
        
    return cluster_centroids