# -*- coding: utf-8 -*-
# @Author: fyr91
# @Date:   2019-10-22 15:05:15
# @Last Modified by:   User
# @Last Modified time: 2019-10-30 22:06:32
import os
import cv2
import numpy as np
from imutils import face_utils
import tensorflow as tf
import pickle
import onnx
import onnxruntime as ort
from onnx_tf.backend import prepare

def area_of(left_top, right_bottom):
    """
    Compute the areas of rectangles given two corners.
    Args:
        left_top (N, 2): left top corner.
        right_bottom (N, 2): right bottom corner.
    Returns:
        area (N): return the area.
    """
    hw = np.clip(right_bottom - left_top, 0.0, None)
    return hw[..., 0] * hw[..., 1]

def iou_of(boxes0, boxes1, eps=1e-5):
    """
    Return intersection-over-union (Jaccard index) of boxes.
    Args:
        boxes0 (N, 4): ground truth boxes.
        boxes1 (N or 1, 4): predicted boxes.
        eps: a small number to avoid 0 as denominator.
    Returns:
        iou (N): IoU values.
    """
    overlap_left_top = np.maximum(boxes0[..., :2], boxes1[..., :2])
    overlap_right_bottom = np.minimum(boxes0[..., 2:], boxes1[..., 2:])

    overlap_area = area_of(overlap_left_top, overlap_right_bottom)
    area0 = area_of(boxes0[..., :2], boxes0[..., 2:])
    area1 = area_of(boxes1[..., :2], boxes1[..., 2:])
    return overlap_area / (area0 + area1 - overlap_area + eps)

def hard_nms(box_scores, iou_threshold, top_k=-1, candidate_size=200):
    """
    Perform hard non-maximum-supression to filter out boxes with iou greater
    than threshold
    Args:
        box_scores (N, 5): boxes in corner-form and probabilities.
        iou_threshold: intersection over union threshold.
        top_k: keep top_k results. If k <= 0, keep all the results.
        candidate_size: only consider the candidates with the highest scores.
    Returns:
        picked: a list of indexes of the kept boxes
    """
    scores = box_scores[:, -1]
    boxes = box_scores[:, :-1]
    picked = []
    indexes = np.argsort(scores)
    indexes = indexes[-candidate_size:]
    while len(indexes) > 0:
        current = indexes[-1]
        picked.append(current)
        if 0 < top_k == len(picked) or len(indexes) == 1:
            break
        current_box = boxes[current, :]
        indexes = indexes[:-1]
        rest_boxes = boxes[indexes, :]
        iou = iou_of(
            rest_boxes,
            np.expand_dims(current_box, axis=0),
        )
        indexes = indexes[iou <= iou_threshold]

    return box_scores[picked, :]

def predict(width, height, confidences, boxes, prob_threshold, iou_threshold=0.5, top_k=-1):
    """
    Select boxes that contain human faces
    Args:
        width: original image width
        height: original image height
        confidences (N, 2): confidence array
        boxes (N, 4): boxes array in corner-form
        iou_threshold: intersection over union threshold.
        top_k: keep top_k results. If k <= 0, keep all the results.
    Returns:
        boxes (k, 4): an array of boxes kept
        labels (k): an array of labels for each boxes kept
        probs (k): an array of probabilities for each boxes being in corresponding labels
    """
    boxes = boxes[0]
    confidences = confidences[0]
    picked_box_probs = []
    picked_labels = []
    for class_index in range(1, confidences.shape[1]):
        probs = confidences[:, class_index]
        mask = probs > prob_threshold
        probs = probs[mask]
        if probs.shape[0] == 0:
            continue
        subset_boxes = boxes[mask, :]
        box_probs = np.concatenate([subset_boxes, probs.reshape(-1, 1)], axis=1)
        box_probs = hard_nms(box_probs,
           iou_threshold=iou_threshold,
           top_k=top_k,
           )
        picked_box_probs.append(box_probs)
        picked_labels.extend([class_index] * box_probs.shape[0])
    if not picked_box_probs:
        return np.array([]), np.array([]), np.array([])
    picked_box_probs = np.concatenate(picked_box_probs)
    picked_box_probs[:, 0] *= width
    picked_box_probs[:, 1] *= height
    picked_box_probs[:, 2] *= width
    picked_box_probs[:, 3] *= height
    return picked_box_probs[:, :4].astype(np.int32), np.array(picked_labels), picked_box_probs[:, 4]

base_path = os.environ.get('MODEL_DIRECTORY', '/twain/model')
embedding_path = os.path.join(base_path, 'embeddings', 'embeddings.pkl')
mfn_ckpt_path = os.path.join(base_path, 'mfn', 'mfn.ckpt')
mfn_ckpt_meta_path = os.path.join(base_path, 'mfn', 'mfn.ckpt.meta')
onnx_path = os.path.join(base_path, 'ultra_light', 'ultra_light_640.onnx')
onnx_model = onnx.load(onnx_path)
predictor = prepare(onnx_model)
ort_session = ort.InferenceSession(onnx_path)
input_name = ort_session.get_inputs()[0].name

# shape_predictor = dlib.shape_predictor('models/facial_landmarks/shape_predictor_5_face_landmarks.dat')
# fa = face_utils.facealigner.FaceAligner(shape_predictor, desiredFaceWidth=112, desiredLeftEye=(0.3, 0.3))

threshold = 0.63

# load distance
with open(embedding_path, "rb") as f:
    (saved_embeds, names) = pickle.load(f)

with tf.Graph().as_default():
    with tf.Session() as sess:

        saver = tf.train.import_meta_graph(mfn_ckpt_meta_path)
        saver.restore(sess, mfn_ckpt_path)

        images_placeholder = tf.get_default_graph().get_tensor_by_name("input:0")
        embeddings = tf.get_default_graph().get_tensor_by_name("embeddings:0")
        phase_train_placeholder = tf.get_default_graph().get_tensor_by_name("phase_train:0")
        embedding_size = embeddings.get_shape()[1]

        video_capture = cv2.VideoCapture(0)

        while True:
            fps = video_capture.get(cv2.CAP_PROP_FPS)
            ret, frame = video_capture.read()

            # preprocess faces
            h, w, _ = frame.shape
            img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = cv2.resize(img, (640, 480))
            img_mean = np.array([127, 127, 127])
            img = (img - img_mean) / 128
            img = np.transpose(img, [2, 0, 1])
            img = np.expand_dims(img, axis=0)
            img = img.astype(np.float32)

            # detect faces
            confidences, boxes = ort_session.run(None, {input_name: img})
            boxes, labels, probs = predict(w, h, confidences, boxes, 0.7)

            # locate faces
            faces = []
            boxes[boxes<0] = 0

            for i in range(boxes.shape[0]):
                box = boxes[i, :]
                x1, y1, x2, y2 = box
                f = frame[y1:y2, x1:x2]
                faces.append(f)
            
            if len(faces) > 0:
                max_idx = 0
                max_size_face = faces[0]

                for idx in range(1, len(faces)):
                    f = faces[idx]
                    if f.size > max_size_face.size:
                        max_size_face = f
                        max_idx = idx

                try:
                    resized_image = cv2.resize(max_size_face, dsize=(112,112))
                except Exception as e:
                    print(e)
                resized_image = resized_image - 127.5
                resized_image = resized_image * 0.0078125

                faces = np.array([resized_image])
                feed_dict = { images_placeholder: faces, phase_train_placeholder:False }
                embeds = sess.run(embeddings, feed_dict=feed_dict)

                # prediciton using distance
                prediction = "unknown"
                embedding = embeds[0]
                diff = np.subtract(saved_embeds, embedding)
                dist = np.sum(np.square(diff), 1)
                idx = np.argmin(dist)
                if dist[idx] < threshold:
                    prediction = names[idx]

                # draw
                box = boxes[max_idx, :]
                text = f"{prediction}"
                
                print(text)

            # Hit 'q' on the keyboard to quit!
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

# Release handle to the webcam
video_capture.release()
