<?php
include "masterfile/api/connection-pdo.php";
$stmt = $conn->query("SELECT shift_id, opening_cash, floats_added_total, lifts_total, current_float FROM tblshifts ORDER BY shift_id DESC LIMIT 1");
$row = $stmt->fetch(PDO::FETCH_ASSOC);
echo "=== CURRENT SHIFT ===\n";
print_r($row);
echo "\n=== DRAWER EVENTS FOR THIS SHIFT ===\n";
$evt = $conn->prepare("SELECT event_type, amount FROM tbldrawer_events WHERE shift_id = ?");
$evt->execute([$row['shift_id']]);
print_r($evt->fetchAll(PDO::FETCH_ASSOC));

