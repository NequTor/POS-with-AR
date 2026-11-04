import fs from "fs";

const path = "masterfile/api/settings.php";
let code = fs.readFileSync(path, "utf8");

const target = `if ($operation === 'assignPromotion') {
  $productId = filter_var($data['productId'] ?? null, FILTER_VALIDATE_INT);
  $promoId = filter_var($data['promoId'] ?? null, FILTER_VALIDATE_INT);
  if (!$productId || $productId < 1 || !$promoId || $promoId < 1) {
    http_response_code(422);
    echo json_encode(["message"=>"Select a valid product and promotion."]);
    exit;
  }
  $product = $conn->prepare("SELECT 1 FROM tblproducts WHERE product_id=:id AND is_active=1");
  $product->execute([":id"=>$productId]);
  $promotion = $conn->prepare("SELECT 1 FROM tblpromo WHERE promo_id=:id");
  $promotion->execute([":id"=>$promoId]);
  if (!$product->fetchColumn() || !$promotion->fetchColumn()) {
    http_response_code(422);
    echo json_encode(["message"=>"The selected product or promotion is unavailable."]);
    exit;
  }
  $stmt = $conn->prepare("INSERT INTO tblproduct_promo(product_id, promo_id) SELECT :productId, :promoId WHERE NOT EXISTS (SELECT 1 FROM tblproduct_promo WHERE product_id=:productId2 AND promo_id=:promoId2)");
  $stmt->execute([":productId"=>$productId, ":promoId"=>$promoId, ":productId2"=>$productId, ":promoId2"=>$promoId]);
  echo json_encode(["returnValue"=>1]);
  exit;
}`;

const replacement = `if ($operation === 'assignPromotion') {
  $promoId = filter_var($data['promoId'] ?? null, FILTER_VALIDATE_INT);
  $rawProductIds = $data['productIds'] ?? ($data['productId'] !== null ? [$data['productId']] : []);
  if (!is_array($rawProductIds)) {
    $rawProductIds = [$rawProductIds];
  }
  $productIds = [];
  foreach ($rawProductIds as $pid) {
    $validId = filter_var($pid, FILTER_VALIDATE_INT);
    if ($validId && $validId > 0) {
      $productIds[] = $validId;
    }
  }

  if (!$promoId || $promoId < 1 || empty($productIds)) {
    http_response_code(422);
    echo json_encode(["message"=>"Select a valid promotion and at least one product."]);
    exit;
  }

  $promotion = $conn->prepare("SELECT promo_name FROM tblpromo WHERE promo_id=:id AND is_active=1");
  $promotion->execute([":id"=>$promoId]);
  $promoRow = $promotion->fetch(PDO::FETCH_ASSOC);
  if (!$promoRow) {
    http_response_code(422);
    echo json_encode(["message"=>"The selected promotion is unavailable."]);
    exit;
  }

  $conn->beginTransaction();
  try {
    $stmt = $conn->prepare("INSERT INTO tblproduct_promo(product_id, promo_id) SELECT :productId, :promoId WHERE NOT EXISTS (SELECT 1 FROM tblproduct_promo WHERE product_id=:productId2 AND promo_id=:promoId2)");
    $assignedCount = 0;
    foreach ($productIds as $pid) {
      $stmt->execute([
        ":productId" => $pid,
        ":promoId" => $promoId,
        ":productId2" => $pid,
        ":promoId2" => $promoId
      ]);
      $assignedCount += $stmt->rowCount();
    }
    $conn->commit();
  } catch (Exception $e) {
    $conn->rollBack();
    http_response_code(500);
    echo json_encode(["message"=>"Failed to assign products to promotion."]);
    exit;
  }

  echo json_encode([
    "returnValue" => 1,
    "promoName" => $promoRow['promo_name'],
    "assignedCount" => $assignedCount,
    "totalSubmitted" => count($productIds),
    "message" => "{$assignedCount} product(s) assigned to {$promoRow['promo_name']}."
  ]);
  exit;
}`;

const normTarget = target.replace(/\r\n/g, "\n");
const normCode = code.replace(/\r\n/g, "\n");
if (!normCode.includes(normTarget)) {
  console.error("Target not found!");
  process.exit(1);
}
const updated = normCode.replace(normTarget, replacement.replace(/\r\n/g, "\n")).replace(/\n/g, "\r\n");
fs.writeFileSync(path, updated, "utf8");
console.log("Successfully patched masterfile/api/settings.php!");

