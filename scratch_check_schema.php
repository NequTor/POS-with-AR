<?php
include "masterfile/api/connection-pdo.php";
echo "=== TBLSHIFTS ===\n";
foreach ($conn->query("DESCRIBE tblshifts")->fetchAll(PDO::FETCH_ASSOC) as $c) {
    echo $c['Field'] . " (" . $c['Type'] . ")\n";
}
echo "\n=== TBLDRAWER_EVENTS ===\n";
foreach ($conn->query("DESCRIBE tbldrawer_events")->fetchAll(PDO::FETCH_ASSOC) as $c) {
    echo $c['Field'] . " (" . $c['Type'] . ")\n";
}

