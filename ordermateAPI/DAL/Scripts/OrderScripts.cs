namespace ordermateAPI.DAL.Scripts;

public static class OrderScripts
{
    public static string GetByStoreId = "SELECT * FROM Orders WHERE StoreId = @storeId";
    public static string Get = "SELECT * FROM Orders WHERE OrderId = @orderId";
    public static string GetByOrderNumber = "SELECT * FROM Orders WHERE OrderNumber = @orderNumber";

    public static string CreateOrder = "INSERT INTO Orders (StoreId, OrderNumber, OrderStatus, Email, TotalValue, Notes, CompletedDate, CreatedDate, LastModifiedDate) VALUES (@storeId, @orderNumber, 0, @email, 0, '', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) SELECT CAST(SCOPE_IDENTITY() AS INT);";

    public static string UpdateOrderTotalValue = "UPDATE Orders SET TotalValue = @totalValue, LastModifiedDate = CURRENT_TIMESTAMP WHERE OrderId = @orderId;";
}