namespace ordermateAPI.DAL.Models;

public class OrderModel
{
    public int OrderId { get; set; }
    public int StoreId { get; set; }
    public string OrderNumber { get; set; }
    public int OrderStatus { get; set; }
    public string Email { get; set; }
    public decimal TotalValue { get; set; }
    public string Notes { get; set; }
    public DateTime CompletedDate { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}